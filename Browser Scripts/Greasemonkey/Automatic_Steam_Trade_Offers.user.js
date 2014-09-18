// ==UserScript==
// @name        Automatic Steam Trade Offers
// @namespace   steam
// @description This extension allows to pre-select the seller's item automatically when clicking a trade offer link if an item is specified.
// @match       *://steamcommunity.com/tradeoffer/new/*
// @version     1
// @grant       none
// @downloadURL https://bitbucket.org
// @updateURL   https://bitbucket.org
// ==/UserScript==

// Copyright (c) 2014 backpack.tf. All rights reserved.
var getParameterByName = function(name) {
    var regex = new RegExp("[\\?&]" + name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]") + "=([^&#]*)"),
        results = regex.exec(location.search);
    return results == null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
}
if(getParameterByName('for_item')) {
	var item = getParameterByName('for_item').split("_");
	var scr = document.createElement("script");
	scr.type="text/javascript";
	scr.innerHTML = '	g_rgCurrentTradeStatus = {"newversion":true,"version":1,"me":{"assets":[],"currency":[],"ready":false},"them":{"assets":[{"appid":"' + item[0] + '","contextid":"'+ item[1] + '","assetid":"'+ item[2] +'","amount":1}],"currency":[],"ready":false}};' +
					'	RefreshTradeStatus( g_rgCurrentTradeStatus, true );';
	document.body.appendChild(scr);
}