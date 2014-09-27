var fs = require("fs");
var request = require("request");
var prompt = require("prompt");
var winston = require("winston");
var moment = require("moment");
var Steam = require("steam");
var SteamTradeOffers = require("steam-tradeoffers");
var offers = new SteamTradeOffers();
var client = new Steam.SteamClient();

var heartbeattimer;
var resolveoffertimer;
var getcounttimer;
var settings = {};
var appinfo = {};
var sessionID = null;
var errorCount = [];
var processing = [];
var backpackurl = "http://backpack.tf";

var TradeOffer = {
    ETradeOfferStateActive: 2,
    ETradeOfferStateAccepted: 3,
};

var ItemQualities = {
    Unique: "6"
};

if (fs.existsSync("package.json")) {
    appinfo = JSON.parse(fs.readFileSync("package.json"));
} else {
    logger.error("Missing package.json");
    process.exit(1);
}

prompt.message = "";
prompt.delimiter = "";

if (fs.existsSync("settings.json")) {
    try {
        settings = JSON.parse(fs.readFileSync("settings.json"));
    } catch (ex) {
        console.log(ex + " in settings.json, exiting.");
        process.exit(1);
    }
}

if (!settings.dateFormat)
    settings.dateFormat = "HH:mm:ss";

var logger = new (winston.Logger)({
    transports: [
        new (winston.transports.Console)({ colorize: true, timestamp: function () {
            return moment().format(settings.dateFormat);
        } }),
        new (winston.transports.File)({ filename: "bot.log", json: false, timestamp: function () {
            return moment().format(settings.dateFormat);
        } })
    ]
});

logger.info("backpack.tf automatic v%s starting", appinfo.version);
dateLog();

if (settings.account) {
    login();
} else {
    prompt.get({
        properties: {
            username: {
                description: "> ".red + "Steam username".green + ":".red,
                type: "string",
                required: true
            },
            password: {
                description: "> ".red + "Steam password".green + ":".red,
                type: "string",
                hidden: true,
                required: true
            },
            token: {
                description: "> ".red + "backpack.tf token".green + ":".red,
                type: "string",
                required: true
            }
        }
    }, function (err, result) {
        if (err) {
            logger.error(err + " reading Steam details, quitting.");
            process.exit(1);
        } else {
            settings.account = {};
            settings.account.password = result.password;
            settings.account.accountName = result.username;
            settings.account.token = result.token;

            fs.writeFile("settings.json", JSON.stringify(settings, null, 4), function (err) {
                if (err) {
                    logger.error(err);
                } else {
                    logger.info("Configuration saved to settings.json.");
                    client.logOn(settings.account);
                }
            });
        }
    });
}

function dateLog() {
    setTimeout(dateLog, moment().endOf("day").diff(moment()));
    logger.info(moment().format("dddd, MMMM Do, YYYY"));
}

client.on("error", function (e) {
    if (e.eresult === Steam.EResult.AccountLogonDenied) {
        prompt.get({
            properties: {
                authcode: {
                    description: "> ".red + "Steam guard code".green + ":".red,
                    type: "string",
                    required: true
                }
            }
        }, function (err, result) {
            if (err) {
                logger.error("Error " + err + " getting Steam guard code, quitting.");
                process.exit(1);
            } else {
                client.logOn({accountName: settings.account.accountName, password: settings.account.password, authCode: result.authcode});
            }
        });
    } else if (e.cause === "logonFail") {
        logger.warn("Failed to login to Steam. Trying again in 60 seconds.");
        clearTimeout(heartbeattimer);
        setTimeout(login, 60000);
    } else if (e.cause === "loggedOff") {
        logger.warn("Logged off from Steam. Trying again in 10 seconds.");
        clearTimeout(heartbeattimer);
        setTimeout(login, 10000);
    } else {
        for (var result in Steam.EResult) {
            if (Steam.EResult[result] == e.eresult) {
                logger.error("Steam error: " + result);
                process.exit(2);
            }
        }
    }
});

function login() {
    logger.info("Connecting to Steam...");
    client.logOn({
        accountName: settings.account.accountName,
        password: settings.account.password,
        shaSentryfile: new Buffer(settings.account.shaSentryfile, "base64")
    });
}

function webLogin() {
    client.webLogOn(function (data) {
        logger.info("Offer handling ready.");
        offers.setup(sessionID, data, function() {
            errorCount.forEach(function (val, key) {
                if (val >= 6) {
                    processing[key] = 0;
                    errorCount[key] = 0;
                }
            });

            //Check if we missed anything while we were gone
            clearTimeout(getcounttimer);
            getOfferCount(0, 0);
        });
    });
}

client.on("sentry", function (sentry) {
    settings.account.shaSentryfile = sentry.toString("base64");
    fs.writeFile("settings.json", JSON.stringify(settings, null, 4), function (err) {
        if (err) {
            logger.error(err);
        } else {
            logger.info("Sentry information saved to settings.json");
        }
    });
});

client.on("loggedOn", function () {
    logger.info(settings.account.accountName + " is now connected.");
    heartbeat();
});

client.on("webSessionID", function (data) {
    sessionID = data;
    webLogin();
});

client.on("tradeOffers", function (count) {
    logger.info(count + " trade offer" + (count != 1 ? "s" : "") + " pending.");
    if (count !== 0) {
        resolveOffers();
    }
});

offers.on("error", function (e) {
    logger.warn(e + " - Refreshing web cookie.");
    webLogin();
});

function getOfferCount(timestamp, lastcount) {
    clearTimeout(getcounttimer);
    var newtimestamp = Math.round(Date.now() / 1000);
    request({
            uri: "http://api.steampowered.com/IEconService/GetTradeOffersSummary/v1?key=" + offers.APIKey + "&time_last_visit=" + timestamp,
            json: true
        },
        function (err, response, body) {
            if (response.statusCode && response.statusCode == 200 && body.response) {
                if (body.response.pending_received_count > lastcount) {
                    resolveOffers();
                }
                lastcount = body.response.pending_received_count;
            }
            getcounttimer = setTimeout(function () {
                getOfferCount(newtimestamp, lastcount);
            }, 60000);
        }
    );
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
            logger.warn(err + " receiving offers, re-trying in 10 seconds.");
            resolveoffertimer = setTimeout(resolveOffers, 10000);
        } else {
            try {
                offerhist.response.trade_offers_received.forEach(function (offer) {
                    if (offer.trade_offer_state === TradeOffer.ETradeOfferStateActive) {
                        checkOffer(offer);
                    }
                });
            } catch (e) {
                //not important, usually because no offers.
            }
        }
    });
}

function checkOffer(offer) {
    //Check if the offer is not in an existing process before continuing, so we don't process the same offer multiple times
    if (processing[offer.tradeofferid])
        return;

    processing[offer.tradeofferid] = 1;

    // we only check offers that involve a complete trade
    if (offer.items_to_give !== undefined && offer.items_to_receive !== undefined) {
        var theirbackpack = [],
            mybackpack = [];

        // we only want to deal with TF2 offers
        var valid = offer.items_to_receive.every(function (item) {
            return item.appid == 440;
        });

        if (valid) {
            logger.info("[%d] Checking offer from %s...", offer.tradeofferid, offer.steamid_other);
            try {
                offers.loadPartnerInventory(offer.steamid_other, 440, 2, function (err, data) {
                    if (err) {
                        valid = false;
                    } else {
                        theirbackpack = data;
                        offers.loadMyInventory(440, 2, function (err, data) {
                            if (err)
                                valid = false;
                            else {
                                mybackpack = data;
                                processOffer(offer, mybackpack, theirbackpack);
                                return;
                            }
                        });
                    }
                });
            } catch (e) {
                valid = false;
            }

            if (!valid) {
                logger.warn("[" + offer.tradeofferid + "/" + offer.steamid_other + "] Failed to download inventories. Retrying in 5 seconds...");
                delete processing[offer.tradeofferid];
                setTimeout(function () {
                    checkOffer(offer);
                }, 5000);
                return;
            }
        } else
            logger.info("[" + offer.tradeofferid + "/" + offer.steamid_other + "] Skipping: Includes non-supported items.");
    } else
        logger.info("[" + offer.tradeofferid + "/" + offer.steamid_other + "] Skipping: Not one of ours.");
}

function processOffer(offer, mybackpack, theirbackpack) {
    var myitems = [],
        theiritems = [],
        myitemids = [],
        isValid = true,
        refined = 0,
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
        if (item.market_name == "Refined Metal" && item.app_data.quality == ItemQualities.Unique)
            myrefined += 1;
        else if (item.market_name == "Reclaimed Metal" && item.app_data.quality == ItemQualities.Unique)
            myrefined += 1 / 3;
        else if (item.market_name == "Scrap Metal" && item.app_data.quality == ItemQualities.Unique)
            myrefined += 1 / 9;
        else
            isChange = false;

        if (isChange)
            changeitems++;

        if (!itemnames[item.market_name])
            itemnames[item.market_name] = 1;
        else
            itemnames[item.market_name]++;
    });

    theiritems.forEach(function (item) {
        // we don't want non-craftable or gifted items, unless it's keys, gg valf
        if (item.market_name != "Mann Co. Supply Crate Key" && (item.craftable === false || item.gifted === true))
            isValid = false;

        // these are the only items we accept
        if (item.market_name == "Mann Co. Supply Crate Key" && item.app_data.quality == ItemQualities.Unique)
            keys++;
        else if (item.market_name == "Refined Metal" && item.app_data.quality == ItemQualities.Unique)
            refined += 1;
        else if (item.market_name == "Reclaimed Metal" && item.app_data.quality == ItemQualities.Unique)
            refined += 1 / 3;
        else if (item.market_name == "Scrap Metal" && item.app_data.quality == ItemQualities.Unique)
            refined += 1 / 9;
        else if (item.market_name == "Earbuds" && item.app_data.quality == ItemQualities.Unique)
            earbuds += 1;
        else {
            isValid = false;
            if (item.craftable === true && item.app_data.quality == ItemQualities.Unique) {
                // we'll also take random weapons at half a scrap
                item.tags.forEach(function (tag) {
                    if ((tag.category == "Type" && tag.internal_name == "secondary") ||
                        (tag.category == "Type" && tag.internal_name == "primary") ||
                        (tag.category == "Type" && tag.internal_name == "pda2") ||
                        (tag.category == "Type" && tag.internal_name == "building") ||
                        (tag.category == "Type" && tag.internal_name == "melee")) {
                        isValid = true;
                        refined += 1 / 18;
                    }
                });
            }
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
            if (err || response.statusCode != 200) {
                logger.warn("[%d] Error reaching backpack.tf, rechecking in 10 seconds...", offer.tradeofferid);
                setTimeout(function () {
                    processOffer(offer, mybackpack, theirbackpack);
                }, 10000);
            } else {
                if (body.response && body.response.success) {
                    body.response.store.forEach(function (item) {
                        for (var index in item.currencies) {
                            if (index == "keys")
                                mykeys += item.currencies[index];
                            else if (index == "earbuds")
                                myearbuds += item.currencies[index];
                            else if (index == "metal") {
                                myrefined += item.currencies[index];
                            }
                        }
                    });

                    refined = Math.floor(Math.round(refined * 18) / 18 * 100) / 100;
                    myrefined = Math.floor(Math.round(myrefined * 18) / 18 * 100) / 100;

                    var combinednames = [];
                    for (var key in itemnames) {
                        combinednames.push(key + " x" + itemnames[key])
                    }

                    var message = "Asked:" +
                        (myearbuds ? " " + myearbuds + " earbud" + (myearbuds != 1 ? "s" : "") : "") +
                        (mykeys ? " " + mykeys + " key" + (mykeys != 1 ? "s" : "") : "") +
                        (myrefined ? " " + myrefined + " refined" : "") +
                        " (" + combinednames.join(", ") + "). Offered:" +
                        (earbuds ? " " + earbuds + " earbud" + (earbuds != 1 ? "s" : "") : "") +
                        (keys ? " " + keys + " key" + (keys != 1 ? "s" : "") : "") +
                        (refined ? " " + refined + " refined" : "");

                    logger.info("[%d] %s", offer.tradeofferid, message);

                    if (
                        myrefined == refined && // matching currencies
                            myearbuds == earbuds &&
                            mykeys == keys &&
                            body.response.store.length && // make sure the person asked for something else than metal
                            body.response.store.length == (offer.items_to_give.length - changeitems) // matching number of items
                        ) {
                        if (body.response.other && (body.response.other.scammer || body.response.other.banned)) {
                            logger.warn("[%d] %s is banned, declining trade offer...", offer.tradeofferid, offer.steamid_other);
                            offers.declineOffer(offer.tradeofferid, function () {
                                delete processing[offer.tradeofferid];
                            });
                        } else {
                            acceptOffer(offer);
                        }
                    } else {
                        logger.warn("[%d] Skipping: This offer does not match any backpack.tf listing.", offer.tradeofferid);
                    }
                } else {
                    logger.warn("[%d] Error reaching backpack.tf, rechecking in 10 seconds...", offer.tradeofferid);
                    setTimeout(function () {
                        processOffer(offer, mybackpack, theirbackpack);
                    }, 10000);
                }
            }
        });
    } else
        logger.warn("[%d] Skipping: Offered invalid items.", offer.tradeofferid);
}

function acceptOffer(offer) {
    offers.acceptOffer(offer.tradeofferid, function (err) {
        if (err) {
            logger.warn("[%d] Error occurred whilst accepting - retrying in 10 seconds...", offer.tradeofferid);
            if (!errorCount[offer.tradeofferid])
                errorCount[offer.tradeofferid] = 1;
            else
                errorCount[offer.tradeofferid]++;
            if (errorCount[offer.tradeofferid] >= 6) {
                logger.info("Too many errors, refreshing cookie...");
                webLogin();
            } else {
                setTimeout(function () {
                    recheckOffer(offer);
                }, 10000);
            }
        } else {
            offerAccepted(offer);
        }
    });
}

function recheckOffer(offer) {
    logger.info("[%d] Verifying...", offer.tradeofferid);
    offers.getOffer({
        "tradeofferid": offer.tradeofferid
    }, function (err, offerhist) {
        if (err) {
            logger.warn("[%d] Error caught when verifying offer, trying again in 10 seconds...", offer.tradeofferid);
            setTimeout(function () {
                recheckOffer(offer);
            }, 10000);
        } else {
            offer = offerhist.response.offer;
            if (offer.trade_offer_state === TradeOffer.ETradeOfferStateAccepted) {
                offerAccepted(offer);
            } else if (offer.trade_offer_state === TradeOffer.ETradeOfferStateActive) {
                acceptOffer(offer);
            } else {
                logger.warn("[%d] Offer still not valid. Maybe it went through, we'll never know.", offer.tradeofferid);
                delete processing[offer.tradeofferid];
            }
        }
    });
}

function offerAccepted(offer) {
    logger.info("[%d] Accepted offer.", offer.tradeofferid);
    var request_params = {
        uri: backpackurl + "/api/IAutomatic/IOfferDetails/",
        form: {
            method: "completed",
            steamid: client.steamID,
            version: appinfo.version,
            token: settings.account.token,
            offer: offer
        },
        method: "POST"
    };

    request(request_params, function (err, response) {
        if (err || response.statusCode != 200) {
            setTimeout(function () {
                offerAccepted(offer);
            }, 60000);
        }
    });
}

function heartbeat() {
    if (settings.account.token) {
        var request_params = {
            uri: backpackurl + "/api/IAutomatic/IHeartBeat/",
            form: {
                method: "alive",
                version: appinfo.version,
                steamid: client.steamID,
                token: settings.account.token
            },
            json: true,
            method: "POST"
        };

        request(request_params, function (err, response, body) {
            if (err || response.statusCode != 200) {
                logger.warn("Error occurred contacting backpack.tf -- trying again in 60 seconds");
                heartbeattimer = setTimeout(heartbeat, 60000);
            } else {
                if (body.success) {
                    // every 5 minutes should be sufficient
                    heartbeattimer = setTimeout(heartbeat, 60000 * 5);
                } else {
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
                description: "> ".red + "backpack.tf token".green + ":".red,
                type: "string",
                required: true
            }
        }
    }, function (err, result) {
        if (err) {
            logger.error("Error " + err + " reading token.");
            process.exit(1);
        } else {
            settings.account.token = result.token;

            fs.writeFile("settings.json", JSON.stringify(settings, null, 4), function (err) {
                if (err) {
                    logger.error(err);
                } else {
                    logger.info("Token saved to settings.json.");
                    heartbeat();
                }
            });
        }
    });
}
