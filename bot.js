var fs = require('fs');
var request = require('request');
var prompt = require("prompt");
var winston = require('winston');
var Steam = require('steam');
var SteamTradeOffers = require('steam-tradeoffers');
var heartbeattimer;

var offers = new SteamTradeOffers();
var client = new Steam.SteamClient();

var settings = {};
var version = "0.1";
var cookies = null;
var sessionID = null;
var logintimer = 0;
var processing = [];
var backpackurl = "http://backpack.tf";

TradeOffer = {
    ETradeOfferStateInvalid: 1,
    ETradeOfferStateActive: 2,
    ETradeOfferStateAccepted: 3,
    ETradeOfferStateCountered: 4,
    ETradeOfferStateExpired: 5,
    ETradeOfferStateCanceled: 6,
    ETradeOfferStateDeclined: 7,
    ETradeOfferStateInvalidItems: 8
};

prompt.message = "";
prompt.delimiter = "";

var logger = new (winston.Logger)({
    transports: [
        new (winston.transports.Console)({ colorize: true, timestamp: true }),
        new (winston.transports.File)({ filename: 'bot.log', json: false, timestamp: true })
    ]
});

logger.info("backpack.tf automatic v%s starting", version);

if (fs.existsSync("settings.json")) {
    settings = JSON.parse(fs.readFileSync("settings.json"));
    login();
} else {
    prompt.get({
        properties: {
            username: {
                description: "> ".red + "Steam username".green + ":".red,
                type: 'string',
                required: true
            },
            password: {
                description: "> ".red + "Steam password".green + ":".red,
                type: 'string',
                hidden: true,
                required: true
            },
            token: {
                description: "> ".red + "backpack.tf token".green + ":".red,
                type: 'string',
                required: true
            }
        }
    }, function (err, result) {
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
    });
}

client.on('error', function (e) {
    if (e.eresult == Steam.EResult.AccountLogonDenied) {
        prompt.get({
            properties: {
                authcode: {
                    description: "> ".red + "Steam guard code".green + ":".red,
                    type: 'string',
                    required: true
                }
            }
        }, function (err, result) {
            client.logOn({accountName: settings.account.accountName, password: settings.account.password, authCode: result.authcode});
        });
    } else if (e.cause === 'logonFail') {
        logger.warn("Failed to login to Steam.");
        logintimer = 60;
        clearTimeout(heartbeattimer);
        login();
    } else if (e.cause === 'loggedOff') {
        logger.warn("Logged off from Steam.");
        logintimer = 10;
        clearTimeout(heartbeattimer);
        login();
    } else {
        for (var result in Steam.EResult) {
            if (Steam.EResult[result] == e.eresult) {
                logger.error('Steam error: ' + result);
                process.exit(2);
            }
        }
    }
});

function login() {
    if (logintimer == 0) {
        logger.info('Connecting to Steam...');
        client.logOn({
            accountName: settings.account.accountName,
            password: settings.account.password,
            shaSentryfile: new Buffer(settings.account.shaSentryfile, 'base64')
        });
    }
    else {
        logintimer--;
        setTimeout(login, 1000);
    }
};

client.on('sentry', function (sentry) {
    settings.account.shaSentryfile = sentry.toString('base64');
    fs.writeFile("settings.json", JSON.stringify(settings, null, 4), function (err) {
        if (err) {
            logger.error(err);
        } else {
            logger.info("Sentry information saved to settings.json");
        }
    });
});

client.on('loggedOn', function () {
    logger.info(settings.account.accountName + " is now connected.");
    heartbeat();
});

client.on('webSessionID', function (data) {
    var sessionID = data;
    client.webLogOn(function (data) {
        offers.setup(sessionID, data);
        setTimeout(resolveOffers, 2000); //Resolve any offers that were sent when offline.
    });
});

client.on('tradeOffers', function (count) {
    if (count !== 0) {
        resolveOffers();
    }
});

offers.on('error', function(e) {
	logger.warn('Web cookie expired, refreshing');
    client.webLogOn(function (data) {
        offers.setup(sessionID, data);
    });
});


function resolveOffers() {
    offers.getOffers({
        "get_received_offers": 1,
        "get_sent_offers": 0,
        "active_only": 1,
        "time_historical_cutoff": Math.round(Date.now() / 1000) - 3600 // we only load stuff that was posted recently
    }, function (err, offerhist) {
        if (err !== null) {
            logger.warn(err + " receiving offers, re-trying in 10 seconds.");
            setTimeout(resolveOffers, 10000);
        } else {
            receivedOffers = offerhist.response.trade_offers_received;

            try {
                receivedOffers.forEach(function (offer) {
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
    if (processing[offer.tradeofferid] !== undefined)
        return;

    processing[offer.tradeofferid] = 1;

    // we only check offers that involve a complete trade
    if (offer.items_to_give !== undefined && offer.items_to_receive !== undefined) {
        var valid = true,
            theirbackpack = [],
            mybackpack = [];

        offer.items_to_receive.forEach(function (item) {
            if (item.appid != 440)
                valid = false;
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
                setTimeout(function () { checkOffer(offer); }, 5000);
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
        reclaimed = 0,
        scrap = 0,
        keys = 0,
        earbuds = 0;

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

    theiritems.forEach(function (item) {
        // we don't want non-craftable or gifted items, unless it's keys, gg valf
        if (item.market_name != 'Mann Co. Supply Crate Key' && (item.craftable == false || item.gifted == true))
            isValid = false;

        // these are the only items we accept
        if (item.market_name == 'Mann Co. Supply Crate Key')
            keys++;
        else if (item.market_name == 'Refined Metal')
            refined += 1;
        else if (item.market_name == 'Reclaimed Metal')
            reclaimed += 1;
        else if (item.market_name == 'Scrap Metal')
            scrap += 1;
        else if (item.market_name == 'Earbuds')
            earbuds += 1;
        else
            isValid = false;
    });

    if (isValid) {
        while (scrap >= 3) {
            reclaimed++;
            scrap -= 3;
        }

        while (reclaimed >= 3) {
            refined++;
            reclaimed -= 3;
        }

        refined += reclaimed * 0.33 + scrap * 0.11;

        var request_params = {
            uri: backpackurl + "/api/IGetUserTrades/v1/",
            form: {
                steamid_other: offer.steamid_other,
                steamid: client.steamID,
                ids: myitemids
            },
            json: true,
            method: 'POST'
        };

        request(request_params, function (err, data) {
            if (err || !data.body) {
                logger.warn("[%d] Error reaching backpack.tf, rechecking in 10 seconds...", offer.tradeofferid);
                setTimeout(function () {
                    processOffer(offer, mybackpack, theirbackpack);
                }, 10000);
            } else {
                if (data.body.response && data.body.response.success) {
                    var mykeys = 0,
                        myrefined = 0,
                        myearbuds = 0;

                    data.body.response.store.forEach(function (item) {
                        for (var index in item.currencies) {
                            if (index == 'keys')
                                mykeys += item.currencies[index];
                            else if (index == 'earbuds')
                                myearbuds += item.currencies[index];
                            else if (index == 'metal') {
                                myrefined += item.currencies[index];
                            }
                        }
                    });

                    myrefined = Math.floor(Math.round(myrefined * 1800) / 18) / 100; // hacky hack

                    var message = "Asked:" +
                        (myearbuds ? " " + myearbuds + " earbud" + (myearbuds != 1 ? "s" : "") : "") +
                        (mykeys ? " " + mykeys + " key" + (mykeys != 1 ? "s" : "") : "") +
                        (myrefined ? " " + myrefined + " refined" : "") +
                        ". Offered:" +
                        (earbuds ? " " + earbuds + " earbud" + (earbuds != 1 ? "s" : "") : "") +
                        (keys ? " " + keys + " key" + (keys != 1 ? "s" : "") : "") +
                        (refined ? " " + refined + " refined" : "");

                    logger.info("[%d] %s", offer.tradeofferid, message);

                    if (
                            myrefined == refined && // matching currencies
                            myearbuds == earbuds &&
                            mykeys == keys &&
                            data.body.response.store.length == offer.items_to_give.length // matching number of items
                        )
                    {
                        if (data.body.response.other && (data.body.response.other.scammer || data.body.response.other.banned)) {
                            logger.warn("[%d] %s is banned, declining trade offer...", offer.tradeofferid, offer.steamid_other);
                            offers.declineOffer(offer.tradeofferid, function () { delete processing[offer.tradeofferid]; });
                        } else {
                            acceptOffer(offer);
                        }
                    } else {
                        logger.warn("[%d] Skipping: This offer does not match any backpack.tf listing.", offer.tradeofferid);
                    }
                } else {
                    logger.warn("[%d] Error reaching backpack.tf, rechecking in 10 seconds...", offer.tradeofferid);
                    setTimeout(function () { processOffer(offer, mybackpack, theirbackpack); }, 10000);
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
            setTimeout(function () { recheckOffer(offer); }, 10000);
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
            setTimeout(function () { recheckOffer(offer); }, 10000);
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
            method: 'completed',
            steamid: client.steamID,
            token: settings.account.token,
            offer: offer
        },
        json: true,
        method: 'POST'
    };

    request(request_params, function (err, data) {
        if (err) {
            setTimeout(function () { offerAccepted(offer); }, 60000);
        }
    });
}

function heartbeat() {
    if(settings.account.token) {
        var request_params = {
            uri: backpackurl + "/api/IAutomatic/IHeartBeat/",
            form: {
                method: 'alive',
                steamid: client.steamID,
                token: settings.account.token
            },
            json: true,
            method: 'POST'
        };

        request(request_params, function (err, data) {
            if (err || !data.body || data.body.success == undefined) {
                logger.warn("Error occurred contacting backpack.tf -- trying again in 60 seconds");
                heartbeattimer = setTimeout(function () { heartbeat(); }, 60000);
            } else {
                if(data.body.success) {
                    // every 5 minutes should be sufficient
                    heartbeattimer = setTimeout(function () { heartbeat(); }, 60000 * 5);
                } else {
				    logger.error('Invalid backpack.tf token for this account detected. Please update the token below.')
                    getToken();
                }
            }
        });
    } else {
		logger.error('Missing backpack.tf token. Please update the token below.')
        getToken();
    }
}

function getToken() {
    clearTimeout(heartbeattimer);
    prompt.get({
        properties: {
            token: {
                description: "> ".red + "backpack.tf token".green + ":".red,
                type: 'string',
                required: true
            }
        }
    }, function (err, result) {
        settings.account.token = result.token;

        fs.writeFile("settings.json", JSON.stringify(settings, null, 4), function (err) {
            if (err) {
                logger.error(err);
            } else {
                logger.info("Token saved to settings.json.");
                heartbeat();
            }
        });
    });
}
