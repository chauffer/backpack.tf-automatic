var fs = require("fs");
var request = require("./node_modules/steam-tradeoffers/node_modules/request");
var prompt = require("prompt");
var winston = require("winston");
var moment = require("moment");
var extend = require("extend");
var Steam = require("steam");
var SteamTradeOffers = require("steam-tradeoffers");
var offers = new SteamTradeOffers();
var client = new Steam.SteamClient();

var heartbeattimer;
var resolveoffertimer;
var getcounttimer;
var settings = {};
var accountinfo = {};
var appinfo = {};
var lastdatelog;
var sessionID = null;
var errorCount = {};
var processing = {};
var backpackurl = "http://backpack.tf";
var tokenvalidated = false;
var lastcount = -1;
var logger;

var TradeOffer = {
    ETradeOfferStateActive: 2,
    ETradeOfferStateAccepted: 3,
    ETradeOfferStateInvalidItems: 8
};

var ItemQualities = {
    Unique: "6"
};

var defaultSettings = {
    dateFormat: "HH:mm:ss",
    logs: {
        console: {
            level: "debug"
        },
        file: {
            disabled: false,
            level: "debug"
        },
        trade: {
            disabled: false
        }
    },
    accounts: {},
    lastaccount: "",
    autologin: false
};

if (!fs.existsSync("settings.json")) {
    fs.writeFileSync("settings.json", JSON.stringify(defaultSettings, null, 4));
}

try {
    settings = JSON.parse(fs.readFileSync("settings.json"));
} catch (ex) {
    console.log(ex + " in settings.json, exiting.");
    process.exit(1);
}

settings = extend(true, {}, defaultSettings, settings);

function setupLogger() {
    var level = {
        levels: {
            debug: 0,
            verbose: 1,
            info: 2,
            warn: 3,
            error: 4,
            trade: 5
        },
        colors: {
            verbose: 'cyan',
            debug: 'blue',
            info: 'green',
            warn: 'yellow',
            error: 'red',
            trade: 'magenta'
        }
    };

    winston.addColors(level.colors);
    winston.setLevels(level.levels);

    function timestamp() {
        return moment().format(settings.dateFormat);
    }

    var transports = [
        new (winston.transports.Console)({
            name: "console",
            level: settings.logs.console.level || "debug",
            colorize: true,
            timestamp: timestamp
        })
    ];

    if (accountinfo.username) {
        if (!settings.logs.file.disabled) {
            transports.push(new (winston.transports.File)({
                name: "log.all",
                level: settings.logs.file.level || "debug",
                filename: accountinfo.username + ".log",
                json: false,
                timestamp: timestamp
            }));
        }

        if (!settings.logs.trade.disabled) {
            transports.push(new (winston.transports.File)({
                name: "log.trade",
                level: "trade",
                filename: accountinfo.username + ".trade.log",
                timestamp: timestamp,
                json: false
            }));
        }
    }

    logger = new (winston.Logger)({
        transports: transports,
        levels: level.levels,
        colors: level.colors
    });
}

setupLogger();

if (fs.existsSync("package.json")) {
    appinfo = JSON.parse(fs.readFileSync("package.json"));
} else {
    logger.error("Missing package.json");
    process.exit(1);
}

prompt.message = "";

// convert to new format
if(settings.account && settings.account.accountName) {
    settings.accounts[settings.account.accountName] = {
        accountName: settings.account.accountName,
        token: settings.account.token
    };
    if(settings.account.shaSentryfile) {
        settings.accounts[settings.account.accountName].shaSentryfile = settings.account.shaSentryfile;
    }

    settings.lastaccount = settings.account.accountName;
    delete settings.account;
}

fs.watch("settings.json", (function () {
    var change = 0;

    return function (event) {
        if (event === "change") {
            if (change + 100 > Date.now()) {
                return; // throttle
            }

            change = Date.now();

            try {
                settings = JSON.parse(fs.readFileSync("settings.json"));
                logger.info("Settings reloaded.");
            } catch (ex) {
                logger.warn("Syntax error in settings.json, could not reload settings.");
            }
        }
    };
}()));

logger.info("backpack.tf automatic v%s starting", appinfo.version);
dateLog();

function saveSettings(message, callback) {
    fs.writeFile("settings.json", JSON.stringify(settings, null, 4), function (err) {
        if (err) {
            logger.error(err);
        } else {
            if (message) {
                logger.info(message);
            }

            if (callback) {
                callback();
            }
        }
    });
}

function getAccountDetails() {
    prompt.get({
        properties: {
            username: {
                description: "Steam username".green,
                type: "string",
                required: true,
                allowEmpty: false,
                default: settings.lastaccount
            },
            password: {
                description: "Steam password".green + " (hidden)".red,
                type: "string",
                hidden: true,
                required: true,
                allowEmpty: false
            }
        }
    }, function (err, result) {
        if (err) {
            logger.error(err + " reading Steam details, quitting.");
            process.exit(1);
        } else {
            accountinfo.username = result.username;
            accountinfo.password = result.password;

            if(!settings.accounts[accountinfo.username]) {
                settings.accounts[accountinfo.username] = { username: accountinfo.username };
            } else {
                settings.accounts[accountinfo.username].username = accountinfo.username;
            }

            prompt.confirm('Save password to file?'.green + " (plain text)".red, { default: 'no' }, function(err, save) {
                if (err) {
                    logger.error(err + " reading Steam details, quitting.");
                    process.exit(1);
                } else {
                    if(save) {
                        settings.autologin = accountinfo.username;
                        settings.accounts[accountinfo.username].password = accountinfo.password;
                    } else {
                        settings.autologin = false;
                        delete settings.accounts[accountinfo.username].password;
                    }
                    settings.lastaccount = accountinfo.username;
                    saveSettings("Settings saved to settings.json");
                    login(0);
                }
            });
        }
    });
}


var autologinAccount = settings.autologin && settings.accounts[settings.autologin];
if (autologinAccount && autologinAccount.username && autologinAccount.password) {
    accountinfo.username = autologinAccount.username;
    accountinfo.password = autologinAccount.password;
    login(0);
} else {
    getAccountDetails();
}

function dateLog() {
    var text = moment().format("dddd, MMMM Do, YYYY");
    setTimeout(dateLog, moment().endOf("day").diff(moment()));

    if (text !== lastdatelog) {
        logger.info(text);
    }

    lastdatelog = text;
}

client.on("error", function (e) {
    var result;

    if (e.eresult === Steam.EResult.AccountLogonDenied) {
        prompt.get({
            properties: {
                authcode: {
                    description: "Steam guard code".green,
                    type: "string",
                    required: true,
                    allowEmpty: false
                }
            }
        }, function (err, result) {
            if (err) {
                logger.error("Error " + err + " getting Steam guard code, quitting.");
                process.exit(1);
            } else {
                client.logOn({accountName: accountinfo.username, password: accountinfo.password, authCode: result.authcode});
            }
        });
    } else if (e.cause === "logonFail") {
        logger.debug("Invalid user/password specified. Please try again.");
        getAccountDetails();
    } else if (e.cause === "loggedOff") {
        logger.debug("Logged off from Steam. Trying again in 10s.");
        login(10);
    } else {
        for (result in Steam.EResult) {
            if (Steam.EResult[result] === e.eresult) {
                logger.error("Steam error: " + result);
                process.exit(2);
            }
        }
    }
});

// we don't try to login here manually because steam client does that on its own, but we'll stop shit from breaking
client.on("loggedOff", function() {
    clearTimeout(getcounttimer);
    clearTimeout(heartbeattimer);
});

function login(delay) {
    clearTimeout(getcounttimer);
    clearTimeout(heartbeattimer);
    tokenvalidated = false;

    if (delay) {
        setTimeout(function() { login(0); }, delay * 1000);
    } else {
        setupLogger();

        logger.verbose("Connecting to Steam...");
        var logon = {accountName: accountinfo.username, password: accountinfo.password};
        if (settings.accounts[accountinfo.username] && settings.accounts[accountinfo.username].shaSentryfile) {
            logon.shaSentryfile = new Buffer(settings.accounts[accountinfo.username].shaSentryfile, "base64");
        }
        client.logOn(logon);
    }
}

function webLogin(callback) {
    logger.verbose("Connecting to Steam Web...");
    clearTimeout(getcounttimer);
    clearTimeout(heartbeattimer);
    client.webLogOn(function (data) {
        offers.setup({
            "sessionID": sessionID,
            "webCookie": data
        }, function() {
            offers.getAPIKey(function (err) {
                if (err && err.message === 'Access Denied: Family View Enabled') {
                    if(accountinfo.pin) {
                        offers.getFamilyCookie({"pin": accountinfo.pin}, callback);
                    } else {
                        getFamilyPIN(callback);
                    }
                } else {
                    if(accountinfo.pin) {
                        offers.getFamilyCookie({"pin": accountinfo.pin}, function() {
                            offerReady(callback);
                        });
                    } else {
                        offerReady(callback);
                    }
                }
            });
        });
    });
}

function offerReady(callback) {
    var key, val;

    for (key in errorCount) {
        val = errorCount[key];
        if (val >= 6) {
            delete processing[key];
            errorCount[key] = 0;
        }
    }

    logger.info("Offer handling ready.");
    heartbeat();
    if (typeof callback === 'function') {
        callback();
    }
}

client.on("sentry", function (sentry) {
    settings.accounts[accountinfo.username].shaSentryfile = sentry.toString("base64");
    saveSettings("Sentry information saved.");
});

client.on("loggedOn", function () {
    logger.info("Connected to Steam on " + moment().format("dddd, MMMM Do, YYYY"));
});

client.on("webSessionID", function (data) {
    sessionID = data;
    webLogin();
});

client.on("tradeOffers", function (count) {
    // only process offers if token is valid
    if(tokenvalidated) {
        logger.info("steam: " + count + " trade offer" + (count !== 1 ? "s" : "") + " pending.");
        if (count !== 0) {
            resolveOffers();
        }
    }
});

offers.on("error", function (e) {
    logger.debug(e + " - Refreshing web cookie.");
    webLogin();
});

client.on("debug", function(msg) {
    logger.debug("steam: " + msg);
});

offers.on("debug", function(msg) {
    logger.debug("offers: " + msg);
});

function getOfferCount() {
    var uri = "http://api.steampowered.com/IEconService/GetTradeOffersSummary/v1?key=" + offers.APIKey + "&time_last_visit=" + Math.round(Date.now() / 1000);
    clearTimeout(getcounttimer);

    request({uri: uri, json: true}, function (err, response, body) {
        var resp = body && body.response;

        if (response && response.statusCode && response.statusCode === 200 && resp) {
            var pendingCount = resp.pending_received_count,
                newCount = resp.new_received_count;

            if(newCount == 0 && lastcount != -1)
            {
                getOfferCountTimer();
                return;
            }

            logger.debug('offers: ' + pendingCount + ' pending, ' + newCount + ' new received.');

            if (pendingCount > lastcount || newCount) {
                resolveOffers();
            }

            lastcount = pendingCount;
        }
        getOfferCountTimer();
    });
}

function getOfferCountTimer()
{
    getcounttimer = setTimeout(function () {
        getOfferCount();
    }, 60000);
}

function resolveOffers() {
    clearTimeout(resolveoffertimer);
    offers.getOffers({
        "get_received_offers": 1,
        "get_sent_offers": 0,
        "active_only": 1,
        "time_historical_cutoff": Math.round(Date.now() / 1000) - 3600 // we only load recent active offers
    }, function (err, offerhist) {
        if (err !== null) {
            logger.warn(err + " receiving offers, re-trying in 10s.");
            resolveoffertimer = setTimeout(resolveOffers, 10000);
        } else {
            try {
                offerhist.response.trade_offers_received.forEach(function (offer) {
                    if (offer.trade_offer_state === TradeOffer.ETradeOfferStateActive) {
                        checkOffer(offer);
                    } else if (offer.trade_offer_state === TradeOffer.ETradeOfferStateInvalidItems) {
                        discardOffer(offer);
                    }
                });
            } catch (e) {
                //not important, usually because no offers.
            }
        }
    });
}

function loadPartnerInventory(offer) {
    offers.loadPartnerInventory({
        "partnerSteamId": offer.steamid_other,
        "appId": 440,
        "contextId": 2,
        "tradeOfferId": offer.tradeofferid
    }, function (err, data) {
        if (data) {
            loadMyInventory(offer, data);
        } else {
            if (err && err.message && err.message === "No session") {
                logger.warn("[%d] Session expired, refreshing...", offer.tradeofferid);
                webLogin(function() {
                    loadPartnerInventory(offer);
                });
            } else {
                checkOfferState(offer, function() {
                    logger.warn("[%d] Failed to download partner inventory: %s, retrying in 5s...", offer.tradeofferid, err.message);
                    setTimeout(function () {
                        loadPartnerInventory(offer);
                    }, 5000);
                });
            }
        }
    });
}

function loadMyInventory(offer, theirbackpack) {
    offers.loadMyInventory({
        "appId": 440,
        "contextId": 2
    }, function (err, data) {
        if (data) {
            processOffer(offer, data, theirbackpack);
        } else {
            if (err && err.message && err.message === "No session") {
                logger.warn("[%d] Session expired, refreshing...", offer.tradeofferid);
                webLogin(function() {
                    loadMyInventory(offer, theirbackpack);
                });
            } else {
                checkOfferState(offer, function() {
                    logger.warn("[%d] Failed to download my inventory: %s, Retrying in 5s...", offer.tradeofferid, err.message);
                    setTimeout(function () {
                        loadMyInventory(offer, theirbackpack);
                    }, 5000);
                });
            }
        }
    });
}

function checkOfferState(offer, callback) {
    offers.getOffer({
        "tradeofferid": offer.tradeofferid
    }, function (err, offerhist) {
        if (err) {
            logger.debug("[%d] offers: failed to get offer data, retrying in 5s...", offer.tradeofferid);
            setTimeout(function() {
                checkOfferState(offer, callback);
            }, 5000);
        } else {
            if (offerhist.response.offer.trade_offer_state === TradeOffer.ETradeOfferStateAccepted) {
                logger.verbose("[" + offer.tradeofferid + "/" + offer.steamid_other + "] Offer accepted elsewhere, ignoring.", offer.tradeofferid);
                delete processing[offer.tradeofferid];
            } else if (offerhist.response.offer.trade_offer_state === TradeOffer.ETradeOfferStateInvalidItems) {
                discardOffer(offer);
            } else {
                callback();
            }
        }
    });
}

function checkOffer(offer) {
    //Check if the offer is not in an existing process before continuing, so we don't process the same offer multiple times
    if (processing[offer.tradeofferid]) {
        return;
    }

    processing[offer.tradeofferid] = true;

    // we only check offers that involve a complete trade
    if (offer.items_to_give !== undefined && offer.items_to_receive !== undefined) {
        // we only want to deal with TF2 offers
        var valid = offer.items_to_receive.every(function (item) {
            return +item.appid === 440;
        });

        if (valid) {
            logger.info("[%d] Checking offer from %s...", offer.tradeofferid, offer.steamid_other);
            loadPartnerInventory(offer);
        } else {
            logger.info("[" + offer.tradeofferid + "] Skipping: Includes non-supported items.");
        }
    } else {
        logger.info("[" + offer.tradeofferid + "] Skipping: Gift offer.");
    }
}

function processOffer(offer, mybackpack, theirbackpack) {
    var myitems = [],
        theiritems = [],
        myitemids = [],
        isValid = true,
        refined = 0,
        mymetalcurrency = 0,
        metalcurrency = 0,
        keys = 0,
        earbuds = 0,
        mykeys = 0,
        myrefined = 0,
        myearbuds = 0,
        changeitems = 0,
        itemnames = [];

    offer.items_to_give.forEach(function (item, key) {
        mybackpack.forEach(function (inv_item) {
            if (inv_item.id === item.assetid) {
                offer.items_to_give[key].app_data = inv_item.app_data;
                inv_item.craftable = offer.items_to_give[key].app_data.craftable = true;
                inv_item.gifted = offer.items_to_give[key].app_data.gifted = false;

                if (inv_item.descriptions) {
                    inv_item.descriptions.forEach(function (description) {
                        if (description.value.indexOf("Not Usable in Crafting") !== -1) {
                            inv_item.craftable = offer.items_to_give[key].app_data.craftable = false;
                        } else if (description.value.indexOf("Gift from:") !== -1) {
                            inv_item.gifted = offer.items_to_give[key].app_data.gifted = true;
                        }
                    });
                }

                myitems.push(inv_item);
                myitemids.push(inv_item.id);
            }
        });
    });

    offer.items_to_receive.forEach(function (item, key) {
        theirbackpack.forEach(function (inv_item) {
            if (inv_item.id === item.assetid) {
                offer.items_to_receive[key].app_data = inv_item.app_data;
                inv_item.craftable = offer.items_to_receive[key].app_data.craftable = true;
                inv_item.gifted = offer.items_to_receive[key].app_data.gifted = false;

                if (inv_item.descriptions) {
                    inv_item.descriptions.forEach(function (description) {
                        if (description.value.indexOf("Not Usable in Crafting") !== -1) {
                            inv_item.craftable = offer.items_to_receive[key].app_data.craftable = false;
                        } else if (description.value.indexOf("Gift from:") !== -1) {
                            inv_item.gifted = offer.items_to_receive[key].app_data.gifted = true;
                        }
                    });
                }

                theiritems.push(inv_item);
            }
        });
    });

    myitems.forEach(function (item) {
        var isChange = true;

        // these are the only items we give back as change
        if (item.app_data.quality === ItemQualities.Unique) {
            if (item.market_name === "Refined Metal") {
                mymetalcurrency += 2 * 3 * 3;
            } else if (item.market_name === "Reclaimed Metal") {
                mymetalcurrency += 2 * 3;
            } else if (item.market_name === "Scrap Metal") {
                mymetalcurrency += 2;
            } else {
                isChange = false;
            }
        } else {
            isChange = false;
        }

        if (isChange) {
            changeitems++;
        }

        if (!itemnames[item.market_name]) {
            itemnames[item.market_name] = 1;
        } else {
            itemnames[item.market_name]++;
        }
    });

    theiritems.forEach(function (item) {
        // we don't want non-craftable items, unless it's a key, gg valf
        if ((item.market_name !== "Mann Co. Supply Crate Key" && item.market_name !== "End of the Line Key") && (item.craftable === false)) {
            isValid = false;
        }

        // these are the only items we accept
        if (item.app_data.quality === ItemQualities.Unique) {
            if (item.market_name === "Mann Co. Supply Crate Key" || item.market_name === "End of the Line Key") {
                keys++;
            } else if (item.market_name === "Refined Metal") {
                metalcurrency += 2 * 3 * 3;
            } else if (item.market_name === "Reclaimed Metal") {
                metalcurrency += 2 * 3;
            } else if (item.market_name === "Scrap Metal") {
                metalcurrency += 2;
            } else if (item.market_name === "Earbuds") {
                // we don't want gifted earbuds
                if (item.gifted === true) {
                    isValid = false;
                }

                earbuds += 1;
            } else if (item.craftable === true) {
                // we'll also take random weapons at half a scrap
                item.tags.forEach(function (tag) {
                    if (tag.category === "Type" && ["secondary", "primary", "pda2", "building", "melee"].indexOf(tag.internal_name) !== -1) {
                        isValid = true;
                        metalcurrency += 1;
                    }
                });
            } else {
                isValid = false;
            }
        } else {
            isValid = false;
        }
    });

    if (isValid) {
        var request_params = {
            uri: backpackurl + "/api/IGetUserTrades/v1/",
            form: {
                steamid_other: offer.steamid_other,
                steamid: client.steamID,
                ids: myitemids
            },
            json: true,
            method: "POST"
        };

        request(request_params, function (err, response, body) {
            if (err || response.statusCode !== 200) {
                logger.warn("[%d] Error reaching backpack.tf, rechecking in 10s...", offer.tradeofferid);
                setTimeout(function () {
                    processOffer(offer, mybackpack, theirbackpack);
                }, 10000);
            } else {
                if (body.response && body.response.success) {
                    body.response.store.forEach(function (item) {
                        var index, count;

                        for (index in item.currencies) {
                            count = item.currencies[index];

                            if (index === "keys") {
                                mykeys += count;
                            } else if (index === "earbuds") {
                                myearbuds += count;
                            } else if (index === "metal") {
                                mymetalcurrency += Math.ceil(count * 18);
                            }
                        }
                    });

                if(mymetalcurrency > 0)
                    myrefined = Number( ( mymetalcurrency / 18 ).toFixed( 2 ) );
                if(metalcurrency > 0)
                    refined =  Number( ( metalcurrency / 18 ).toFixed( 2 ) );

                    var combinednames = [];
                    for (var key in itemnames) {
                        if (itemnames[key] > 1) {
                            combinednames.push(key + " x" + itemnames[key]);
                        } else {
                            combinednames.push(key);
                        }
                    }

                    var message = "Asked:" +
                        (myearbuds ? " " + myearbuds + " earbud" + (myearbuds !== 1 ? "s" : "") : "") +
                        (mykeys ? " " + mykeys + " key" + (mykeys !== 1 ? "s" : "") : "") +
                        (myrefined ? " " + myrefined + " refined" : "") +
                        " (" + combinednames.join(", ") + "). Offered:" +
                        (earbuds ? " " + earbuds + " earbud" + (earbuds !== 1 ? "s" : "") : "") +
                        (keys ? " " + keys + " key" + (keys !== 1 ? "s" : "") : "") +
                        (refined ? " " + refined + " refined" : "") + ".";

                    logger.info("[%d] %s", offer.tradeofferid, message);

                    if (
                            mymetalcurrency <= metalcurrency && // matching currencies
                            myearbuds <= earbuds &&
                            mykeys <= keys &&
                            body.response.store.length && // make sure the person asked for something else than metal
                            body.response.store.length === (offer.items_to_give.length - changeitems) // matching number of items
                        ) {
                        if (body.response.other && (body.response.other.scammer || body.response.other.banned)) {
                            logger.warn("[%d] %s is banned, declining trade offer...", offer.tradeofferid, offer.steamid_other);
                            offers.declineOffer({"tradeOfferId": offer.tradeofferid}, function () {
                                delete processing[offer.tradeofferid];
                            });
                        } else {
                            acceptOffer(offer, message);
                        }
                    } else {
                        logger.info("[%d] Skipping: This offer does not match any backpack.tf listing.", offer.tradeofferid);
                    }
                } else {
                    logger.warn("[%d] Error reaching backpack.tf, rechecking in 10s...", offer.tradeofferid);
                    setTimeout(function () {
                        processOffer(offer, mybackpack, theirbackpack);
                    }, 10000);
                }
            }
        });
    } else {
        logger.info("[%d] Skipping: Offered invalid items.", offer.tradeofferid);
    }
}

function acceptOffer(offer, message) {
    offers.acceptOffer({"tradeOfferId": offer.tradeofferid}, function (err) {
        if (err && err.message) {
            var errcodes = err.message.match(/\d+/),
                errorcode = (errcodes ? parseInt(errcodes[0], 10) : -1) || -1;

            if (errorcode === 24 /* cookie expired/steamguard shit */ || errorcode === 28 /* family view probably */) {
                logger.error("[%d] Error %d while accepting - refreshing web cookies...", offer.tradeofferid, errorcode);
                webLogin(function () {
                    setTimeout(function () {
                        recheckOffer(offer, message);
                    }, 5000);
                });
            } else {
                logger.error("[%d] %s - retrying in 10s...", offer.tradeofferid, err.message);

                if (!errorCount[offer.tradeofferid]) {
                    errorCount[offer.tradeofferid] = 1;
                } else {
                    errorCount[offer.tradeofferid]++;
                }

                if (errorCount[offer.tradeofferid] >= 6) {
                    logger.debug("Too many errors for a single offer, forcing session refresh...");
                    login(0);
                } else {
                    setTimeout(function () {
                        recheckOffer(offer, message);
                    }, 10000);
                }
            }
        } else {
            offerAccepted(offer, message);
        }
    });
}

function recheckOffer(offer, message) {
    logger.verbose("[%d] Verifying...", offer.tradeofferid);
    offers.getOffer({
        "tradeofferid": offer.tradeofferid
    }, function (err, offerhist) {
        if (err) {
            setTimeout(function () {
                recheckOffer(offer);
            }, 1000);
        } else {
            offer = offerhist.response.offer;
            if (offer.trade_offer_state === TradeOffer.ETradeOfferStateAccepted) {
                offerAccepted(offer, message);
            } else if (offer.trade_offer_state === TradeOffer.ETradeOfferStateActive) {
                acceptOffer(offer, message);
            } else if (offer.trade_offer_state === TradeOffer.ETradeOfferStateInvalidItems) {
                discardOffer(offer);
            } else {
                logger.warn("[%d] Offer still not valid. Maybe it went through, we'll never know.", offer.tradeofferid);
                delete processing[offer.tradeofferid];
            }
        }
    });
}

function discardOffer(offer) {
    logger.verbose("[" + offer.tradeofferid + "/" + offer.steamid_other + "] Offer contains items no longer available, discarding.");
    offers.declineOffer({"tradeOfferId": offer.tradeofferid}, function () {
        delete processing[offer.tradeofferid];
    });
}

function offerAccepted(offer, message) {
    logger.transports['log.trade'].log('trade', message);
    logger.trade("[%d] Accepted offer.", offer.tradeofferid);
    var request_params = {
        uri: backpackurl + "/api/IAutomatic/IOfferDetails/",
        form: {
            method: "completed",
            steamid: client.steamID,
            token: settings.accounts[accountinfo.username].token,
            offer: offer,
        },
        method: "POST"
    };

    request(request_params, function (err, response) {
        if (err || response.statusCode !== 200) {
            logger.warn("[%d] Error reaching backpack.tf, resending in 60s...", offer.tradeofferid);
            setTimeout(function () {
                offerAccepted(offer);
            }, 60000);
        }
    });
}

function heartbeat() {
    if (settings.accounts[accountinfo.username].token) {
        var request_params = {
            uri: backpackurl + "/api/IAutomatic/IHeartBeat/",
            form: {
                method: "alive",
                steamid: client.steamID,
                token: settings.accounts[accountinfo.username].token
            },
            json: true,
            method: "POST"
        };

        request(request_params, function (err, response, body) {
            if (err || response.statusCode !== 200) {
                logger.warn("Error occurred contacting backpack.tf, trying again in 60s...");
                heartbeattimer = setTimeout(heartbeat, 60000);
            } else {
                if (body.success) {
                    // every 5 minutes should be sufficient
                    heartbeattimer = setTimeout(heartbeat, 60000 * 5);
                    //logger.debug("Heartbeat sent to backpack.tf"); who cares
                    tokenvalidated = true;
                    getOfferCount();
                } else {
                    tokenvalidated = false;
                    logger.error("Invalid backpack.tf token for this account detected. Please update the token below.");
                    getToken();
                }
            }
        });
    } else {
        logger.error("Missing backpack.tf token. Please update the token below.");
        getToken();
    }
}

function getToken() {
    clearTimeout(heartbeattimer);
    prompt.get({
        properties: {
            token: {
                description: "backpack.tf token".green,
                type: "string",
                required: true,
                allowEmpty: false,
                // Tokens are 24 characters
                minLength: 24,
                maxLength: 24
            }
        }
    }, function (err, result) {
        if (err) {
            logger.error("Error " + err + " reading token.");
            process.exit(1);
        } else {
            settings.accounts[accountinfo.username].token = result.token;
            saveSettings("Backpack.tf user token saved.", heartbeat);
        }
    });
}

function getFamilyPIN(callback) {
    prompt.get({
        properties: {
            pin: {
                description: "Steam Family View PIN".green + " (hidden)".red,
                type: "string",
                required: true,
                allowEmpty: false,
                // PINs are 4 characters
                minLength: 4,
                maxLength: 4,
                hidden: true
            }
        }
    }, function (err, result) {
        if (err) {
            logger.error("Error " + err + " reading family pin.");
            process.exit(1);
        } else {
            offers.getFamilyCookie({"pin": result.pin}, function(err) {
                if(err) {
                    logger.warn("Error: " + err.message);
                    getFamilyPIN(callback);
                } else {
                    accountinfo.pin = result.pin;
                    offers.getAPIKey(function(err) {
                        if(err) {
                            logger.warn('Error fetching API key, Please try again...');
                            getFamilyPIN();
                        } else {
                            offerReady(callback);
                        }
                    });
                }
            });
        }
    });
}
