/**
 * roaming.js
 * This file is part of the Yate-BTS Project http://www.yatebts.com
 *
 * Copyright (C) 2014 Null Team
 *
 * This software is distributed under multiple licenses;
 * see the COPYING file in the main directory for licensing
 * information for this specific distribution.
 *
 * This use of this software may be subject to additional restrictions.
 * See the LEGAL file in the main directory for details.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 */

/*
 * Roaming over SIP interface to OpenVoLTE
 * To use it put in javascript.conf:
 *
 * [scripts]
 * roaming=roaming.js
 */

#require "roamingconf.js"

/**
 * Handle "auth" message
 * @param msg Object message to be handled
 */
function onAuth(msg)
{
    var imsi = msg.imsi;
    var tmsi = msg.tmsi;

    var sr = buildRegister(imsi,tmsi,expires,msg.imei);
    if (sr==false)
	return false;
    if (!addAuthParams(sr,msg,imsi,tmsi))
	return false;

    sr.wait = true;
    if (sr.dispatch(true)) {
	if (authSuccess(sr,msg))
	    return true;
	return reqResponse("auth",sr,imsi,msg);
    } else {
	Engine.debug(Engine.DebugWarn, "Could not do xsip.generate for method REGISTER in onAuth.");
    }

    return false;
}

/**
 * Handle "user.register" message
 * @param msg Object message to be handled
 * @param unresponsive_server String This is only set in case of a retrial. IP:port of the last used server 
 */
function onRegister(msg, unresponsive_server)
{
    if (msg.driver!="ybts")
	return false;

    var imsi = msg.imsi;
    var tmsi = msg.tmsi;

    Engine.debug(Engine.DebugInfo, "Preparing to send REGISTER imsi='"+imsi+"', tmsi='"+tmsi+"', unresponsive server='"+unresponsive_server+"'");

    var sr = buildRegister(imsi,tmsi,expires,msg.imei,null,msg,unresponsive_server);
    if (sr==false)
	return false;
    if (!addAuthParams(sr,msg,imsi,tmsi))
	return false;

    sr.wait = true;
    if (sr.dispatch(true)) {
	if (authSuccess(sr,msg)) {
	    // check for expires in Contact header 
	    var contact = sr["sip_contact"];
	    var res = contact.match(/expires *= *"?([^ ;]+)"?/);
	    if (res)
		expires = res[1];
	    else 
		// otherwise check for it in the Expires header
		expires = sr["sip_expires"];

	    expires = parseInt(expires);

	    if (isNaN(expires)) {
		var warning = "Missing Expires header or parameter in Contact header.";
	    } 
	    else {
		if (expires>=t3212) {
		    var half = expires/2;
		    if (half<=t3212) {
			var errmess = "Configuration issue: Timer.T3212 should be smaller than half the Expire time received from server. Expires="+expires+"(seconds), Timer.T3212="+t3212+"(seconds)";
			Engine.debug(Engine.DebugWarn, errmess);
		    }

		    updateSubscribers(msg);
		    return true;
		}
		else
		    var warning = "Configuration issue: Timer.T3212 is higher than Expires received from server. Expires="+expires+", Timer.T3212="+t3212;
	    }
	    Engine.debug(Engine.DebugWarn, warning);

	    // deregister from VLR
	    var sr = buildRegister(imsi,tmsi,0,msg.imei,warning);
	    if (sr!=false)
		sr.enqueue();

	    msg.error = "location-area-not-allowed";
	    return false;	    
	} 
	else if (sr.code == 481) {
	    // unknown tmsi in openvolte
	    // ask phone to redo registration with imsi and imei
	    msg.askimsi = true;
	    msg.askimei = true;
	    msg.assoc_server = sr.used_server;
	    return false;
	}

	if (imsi!="")
	    return reqResponse("register",sr,imsi,msg,unresponsive_server);
	else
	    return reqResponse("register",sr,tmsi,msg,unresponsive_server);
    } 
    else {
	Engine.debug(Engine.DebugWarn, "Could not do xsip.generate for method REGISTER in onRegister.");
    }

    return false;
}

/**
 * Build a SIP REGISTER message 
 * @param imsi String
 * @param tmsi String
 * @param exp Integer Expire time for SIP registration. Min 0, Max 3600 
 * @param imei String representing IMEI of device where request comes from
 * @param warning String - Optional. If set adds Warning header
 * @param msg Object User.register message that generated this request
 * @param unresponsive_server String - Optional. Only set in case of a retrial. This would be the IP:port of the last REGISTER request
 */
function buildRegister(imsi,tmsi,exp,imei,warning,msg,unresponsive_server)
{
    var sip_server;

    if (tmsi!="" && imsi=="") {
	imsi = getIMSI(tmsi);
	msg.imsi = imsi;
    }

    var sr = new Message("xsip.generate");
    sr.method = "REGISTER";
    if (imsi)
	sr.user = "IMSI" + imsi;
    else if (tmsi)
	sr.user = "TMSI" + tmsi;
    else {
	Engine.debug(Engine.DebugWarn, "Exit buildRegister() because it was called without imsi or tmsi.");
	return false;
    }

    if (msg.assoc_server!="" && (msg.assoc_server!=unresponsive_server || !unresponsive_server))
	sip_server = msg.assoc_server;
    else if (!unresponsive_server) {
	if (tmsi=="" && imsi!="") {
	    if (tempinfo[imsi]["server"]!=undefined)
		sip_server = tempinfo[imsi]["server"];
    	}
	if (sip_server==undefined)
	    sip_server = getSIPRegistrar(tmsi);
    } else
	sip_server = getNewRegistrar(unresponsive_server);

    if (!sip_server)
	return false;

    sr.uri = "sip:" + sip_server;
    sr.sip = "sip:" + sr.user + "@" + my_sip;
    var uri = "<" + sr.sip + ">";
    var uri_reg = "<sip:" + sr.user + "@" + sip_server + ">";
    sr.sip_From = uri_reg;
    sr.sip_To = uri_reg;
    sr.sip_Contact = uri + "; expires=" + exp;
    if (imei!="") {
	imei = imei.substr(0,8) + "-" + imei.substr(8,6) + "-" + imei.substr(-1);
	sr.sip_Contact = sr.sip_Contact + "; +sip.instance=\"<urn:gsma:imei:"+ imei +">\"";
    }
    sr.sip_Expires = exp;
    sr["sip_P-Access-Network-Info"] = accnet_header;
    if (msg.phy_info)
	sr["sip_P-PHY-Info"] = "YateBTS; " + msg.phy_info;
    if (warning)
	sr["sip_Warning"] = '399 ' + Engine.runParams("nodename") + ' "' + warning + '"';
    sr.used_server = sip_server;

    return sr;
}

/*
 * Get new server to send request to in case trial to @server timed out
 * @param server String. Previous server that timed out
 * @return String/Bool ip:port of the new server, false if could not find different server to send request to
 */ 
function getNewRegistrar(server)
{
    var no_try = 0;
    var max_tries = 100;
    var new_server = getSIPRegistrar();

    while (new_server==server) {
	if (no_try>=max_tries)
	    return false;
	new_server = getSIPRegistrar();
	no_try++;
    }
    return new_server;
}

/**
 * Add @autz parameter in sr message that will translate to a 
 * Authorization header in the corresonsing SIP request
 * @param sr Object Message object where @autz parameter will be set
 * @param msg Object Message object where authentication parameters are found in
 * @param imsi String
 * @param tmsi String
 * @param autz String. Name of the parameter in @sr where Authorization info is set.
 * Default value "sip_Authorization"
 */
function addAuthParams(sr,msg,imsi,tmsi,autz)
{
    if (!autz)
	autz = "sip_Authorization";

    if (tmsi!="" && imsi=="")
	imsi = getIMSI(tmsi);

    var key;
    if (imsi!="") {
	key = imsi;
	if (tempinfo[key]=="")
	    key = null;
    }
    if (!key && tmsi!="")
	key = tmsi;

    if (key=="") {
	Engine.debug(Engine.DebugWarn, "Missing imsi and tmsi in addAuthParams()");
	return false;
    }

    if (msg["auth.response"]!="") {
	sr[autz] = 'Digest ' + tempinfo[key]["realm"] + 'uri="' + key + '", nonce="' + tempinfo[key]["nonce"] + '", response="' + msg["auth.response"] + '", algorithm=AKAv1-MD5';
    } else if (msg["auth.auts"]!="") {
	sr[autz] = 'Digest ' + tempinfo[key]["realm"] + 'uri="' + key + '", nonce="' + tempinfo[key]["nonce"] + '", response="' + msg["auth.response"] + ', auts="' + msg["auth.auts"] + '", algorithm=AKAv1-MD5';
    } else if (msg.error!="") {
	Engine.debug(Engine.DebugWarn, "Authentication failed for imsi/tmsi: "+key+", error: "+msg.error);
	return false;
    }
    if (tempinfo[key]!="")
	delete tempinfo[key];

    return true;
}

/**
 * Make sure both imsi and tmsi are set in routing messages
 * @param msg Object represent the routing message
 * @param imsi String
 */
function addRoutingParams(msg,imsi)
{
    msg.imsi = imsi;
    msg.tmsi = subscribers[imsi]["tmsi"];
}

/**
 * Handle "chan.disconnected" message
 * @param msg Object message to be handled
 */
function onDisconnected(msg)
{
    if (msg.phy_info) {
	msg["osip_P-PHY-Info"] = "YateBTS; " + msg.phy_info;
	msg["osip-prefix"] = "osip_";
    }

    var chanid = msg.id;
    if (chanid.match(/ybts/) && msg.reason=="noconn")
	msg.reason = "net-out-of-order";

    if (tempinfo_route[chanid]=="")
	return false;

    var msi = tempinfo_route[chanid];
    delete tempinfo_route[chanid];
    if (msg.address.startsWith("TMSI"))
	msi = msg.address.substr(4);
    if (tempinfo[msi]!="")
	delete tempinfo[msi];

    var auth = msg["sip_www-authenticate"];
    if (auth=="") 
	// Different reason for rejecting call
	return false;

    var realm = ""; 
    res = auth.match(/realm *= *"?([^ "]+)"?/); 
    if (res)
	realm = 'realm="' + res[1] + '", ';

    var res = auth.match(/nonce *= *"?([^ "]+)"?/);
    if (res) {
	var nonce = res[1];
	tempinfo[msi] = { "nonce":nonce,"realm":realm };
	var rand = Engine.atoh(nonce);
	if (rand.length > 32) {
	    var autn = rand.substr(32);
	    autn = autn.substr(0,32); 
	    rand = rand.substr(0,32);
	    msg["auth.rand"] = rand;
	    msg["auth.autn"] = autn;
	} else
	    msg["auth.rand"] = rand;
	msg.error = "noauth";
	return true;
    } else 
	Engine.debug(Engine.DebugWarn,"Invalid header: "+auth);

    return false;
}

/**
 * Check if authentication was successfull in REGISTER response
 * @param sr Object. Message where REGISTER response is received
 * @param msg Object. "user.register"/"auth" message that will be handled
 */
function authSuccess(sr,msg)
{
    if ((sr.code/100)==2) {
	var uri = sr["sip_p-associated-uri"];
	if (uri != "") {
	    var res = uri.match(/:?(\+[0-9]+)[@>]/);
	    if (res) { 
		msg.msisdn = res[1];
		var res = uri.match(/tmsi *=" *"?([^ ;]+)"?"/);
		if (res) {
		    msg.tmsi = res[1];
		    return true;
		}
		var res = uri.match(/imsi *=" *"?([^ ;]+)"?"/);
		if (res) {
		    msg.imsi = res[1];
		    return true;
		}
		Engine.debug(Engine.DebugWarn, "Missing both imsi and tmsi in p-associated-uri header: "+uri);
	    } else
		Engine.debug(Engine.DebugWarn, "Missing msisdn in p-associated-uri header: "+uri);
	}
    }
    return false;
}

/**
 * Check request response for authentication parameters
 * @param request_type String. Type of request: register/auth/mosms
 * @param sr Object. Message representing the SIP response where to check for WWW-Authenticate header
 * @param msi String representing imsi or tmsi
 * @param msg Object. Message object to which authentication parameters are added
 * @param server String If set then this was a retrial. Otherwise this is the initial request and a retrial is allowed. Only used for REGISTER requests
 */
function reqResponse(request_type,sr,msi,msg,server)
{
    switch (sr.code) {
	case 401:
	//case 407:
	    var auth = sr["sip_www-authenticate"];

	    var realm = ""; 
	    res = auth.match(/realm *= *"?([^ "]+)"?/); 
	    if (res)
		realm = 'realm="' + res[1] + '", ';

	    var res = auth.match(/nonce *= *"?([^ "]+)"?/);
	    if (res) {
		var nonce = res[1];
		tempinfo[msi] = { "nonce":nonce,"realm":realm};
		if (sr.used_server!="") {
		    tempinfo[msi]["server"] = sr.used_server;
		    msg.assoc_server = sr.used_server;
		}

		var rand = Engine.atoh(nonce);
		if (rand.length > 32) {
		    var autn = rand.substr(32);
		    autn = autn.substr(0,32); 
		    rand = rand.substr(0,32);
		    msg["auth.rand"] = rand;
		    msg["auth.autn"] = autn;
		} else
		    msg["auth.rand"] = rand;
	    } else 
		Engine.debug(Engine.DebugWarn,"Invalid header: "+auth);

	    msg.error = "noauth";
	    if (request_type=="auth")
		return true;
	    break;
	case 408:
	    if (request_type=="register") {
		// make new request to another server
		if (!server)
		    return onRegister(msg,sr.used_server);
	    } else if (request_type=="mosms")
		// Network out of order
		msg.error = 38;

	    msg.reason = "timeout";
	    break;
	default:
	    switch (request_type) {
		case "register":
		case "auth":
		    if (register_translations[sr.code]!=undefined)
			msg.error = register_translations[sr.code];		    	    
		    break;
		case "mosms":
		    if (mosms_translations[sr.code]!=undefined)
			msg.error = mosms_translations[sr.code];
		    break;
	    }
	    break;
    }
    return false;
}

/*
 * Handle "user.unregister" message
 * @param msg Object. Message to be handled
 */
function onUnregister(msg)
{
    if (msg.driver!="ybts")
	return false;

    var imsi = msg.imsi;
    var tmsi = msg.tmsi;
    if (tmsi!="" && imsi=="")
	imsi = getIMSI(tmsi);

    var sr = buildRegister(imsi,tmsi,0,msg.imei);
    if (sr==false)
	return false;

    sr.enqueue();
    // Don't delete subscribers when unregistering. We'll mark them as expired
    //delete subscribers[imsi];
    //saveUE(imsi);
    return true;
}

/*
 * Retrieve IMSI from subscribers list based on TMSI or MSISDN
 * @param tmsi String
 * @param msisdn String
 * @return String Return IMSI or "" if not found
 */
function getIMSI(tmsi, msisdn)
{
    if (tmsi) {
	for (var imsi in subscribers) {
	    if (subscribers[imsi]["tmsi"] == tmsi)
		return imsi;
	}
    } else if (msisdn) {
	for (var imsi in subscribers)
	    if (subscribers[imsi]["msisdn"] == msisdn)
		return imsi;
    }
    return "";
}

/**
 * Handle routing request for SMSs
 * @param msg Object. Message to be handled
 */
function onRouteSMS(msg)
{
    var imsi = msg.imsi;
    var tmsi = msg.tmsi;
    if (tmsi!="" && imsi=="")
	imsi = getIMSI(tmsi);

    if (imsi!="") {
	// MO SMS
	msg.retValue("smsc_yatebts");
    }
    else {
	// MT SMS
	imsi = getIMSI(null, msg.called);
	if (imsi=="" || subscribers[imsi]==undefined) {
	    msg.error = "offline";
	    return false;
	}

	var caller = msg.caller;
	if (caller.substr(0,1)=="+") {
	    caller = caller.substr(1);
	    msg["sms.caller.nature"] = "international";
	}

	msg["sms.caller"] = caller;
	msg.rpdu = msg.xsip_body;
	addRoutingParams(msg,imsi);
	msg.retValue("ybts/IMSI"+imsi);
    }

    return true;
}

/**
 * Handle sending of MO SMS
 * @param msg Object. Message to be handled
 */
function onMoSMS(msg)
{
    Engine.debug(Engine.DebugInfo,"onMoSMS");

    var imsi = msg.imsi;
    var tmsi = msg.tmsi;

    if (msg.caller=="" || msg.called=="" || (imsi=="" && tmsi=="")) {
	// Protocol error, unspecified
	msg.error = "111";
	return false;
    }

    if (tmsi!="" && imsi=="")
	imsi = getIMSI(tmsi);
    if (imsi=="" || subscribers[imsi]==undefined) {
	// Unidentified subscriber
	msg.error = "28";
	return false;
    }

    var sip_server = getSIPRegistrar(tmsi);
    if (!sip_server) {
	// Temporary Failure
	msg.error = "41";
	return false;
    }

    addRoutingParams(msg,imsi);

    var dest = msg["sms.called"];
    if (msg["sms.called.nature"]=="international" && dest.substr(0,1)!="+")
	dest = "+"+dest;
    if (msg.callednumtype=="international" && msg.called.substr(0,1)!="+")
	msg.called = "+"+msg.called;

    var msisdn_caller = subscribers[imsi]["msisdn"];

    var m = new Message("xsip.generate");
    m.method = "MESSAGE";
    m.uri = "sip:" + msg.called  + "@" + sip_server;
    m.user = msisdn_caller; 
    m.sip_To = "<sip:" + msg.called + "@" + sip_server + ">";
    m["sip_P-Called-Party-ID"] = "<tel:" + dest + ">";
    m.xsip_type = "application/vnd.3gpp.sms";
    m.xsip_body_encoding = "hex";
    m.xsip_body = msg.rpdu;
    m["sip_P-Access-Network-Info"] = accnet_header;
    if (msg.phy_info)
	m["sip_P-PHY-Info"] = "YateBTS; " + msg.phy_info;
    m.wait = true;
    if (!addAuthParams(m,msg,imsi,tmsi))
	return false;

    if (m.dispatch(true)) {
	if ((m.code/100)==2) {
	    if (m.xsip_body!="") 
                msg.irpdu = m.xsip_body;
	    return true;
	}
	return reqResponse("mosms",m,imsi,msg);
    } else
	Engine.debug(Engine.DebugWarn, "Could not do xsip.generate for method MESSAGE");

    // Temporary Failure
    msg.error = "41";
    return true;
}

/** 
 * Handle call.route message
 * @param msg Object. Message to be handled
 */
function onRoute(msg)
{
    if (msg.route_type=="msg")
	return onRouteSMS(msg);
    if (msg.route_type!="call" && msg.route_type!="") {
	msg.error = "service-unavailable";
	return false;
    }

    var imsi = msg.imsi;
    var tmsi = msg.tmsi;
    if (tmsi!="" && imsi=="")
	imsi = getIMSI(tmsi);

    if (imsi!="") {
	// MO call
	if (subscribers[imsi]==undefined) {
	    msg.error = "service-unavailable"; // or maybe forbidden
	    return false;
	}

	var sip_server = getSIPRegistrar(tmsi);
	if (!sip_server) {
	    msg.error = "noconn";
	    return false;
	}

	current_calls[msg.id] = imsi;		
	addRoutingParams(msg,imsi);
	// call from inside that must be routed to VLR/MSC if we are online	
	if (msg.callednumtype=="international")
	    msg.called = "+"+msg.called;
	
	tempinfo_route[msg.id] = imsi;
	msg.caller = subscribers[imsi]["msisdn"];

	msg["osip_P-Access-Network-Info"] = accnet_header;
	if (msg.phy_info)
	    msg["osip_P-PHY-Info"] = "YateBTS; " + msg.phy_info;
	msg.retValue("sip/sip:"+msg.called+"@"+sip_server);
    }
    else {
	// MT call

	// check that called is registered in this bts
	imsi = getIMSIFromCalled(msg.called);
	if (imsi=="" || subscribers[imsi]==undefined) {
	    msg.error = "offline";
	    return false;
	}
	if (hasOngoingCall(imsi)) {
	    msg.error = "busy";
	    return false;
	}

    	// call is from openvolte to user registered in this bts
	var caller = msg.caller;
	if (caller.substr(0,1)=="+") {
	    msg.caller = caller.substr(1);
	    msg.callernumtype = "international";
	}

	addRoutingParams(msg,imsi);
    	msg.retValue("ybts/IMSI"+imsi);
    }

    return true;
}

/*
 * Handle chan.hangup message
 * @param msg Object Message to be handled
 */ 
function onHangup(msg)
{
    if (current_calls[msg.id]!="") {
	Engine.debug("Cleaning "+msg.id+" from current MO calls");
	delete current_calls[msg.id];
    }
    return false;
}

/*
 * Add physical channel information
 * @param msg Object Message to be handled
 */
function addPhyInfo(msg)
{
    if (msg.phy_info)
	msg["osip_P-PHY-Info"] = "YateBTS; " + msg.phy_info;
    return false;
}

/*
 * Check if subscriber has ongoing call
 * @param called_imsi String
 * @return Bool true in case imsi has ongoing call, false otherwise
 */ 
function hasOngoingCall(called_imsi)
{
    for (var imsi of current_calls) 
	if (imsi==called_imsi)
	    return true;
    return false;
}

function getIMSIFromCalled(called)
{
    if (called.match(/IMSI/))
	return called.substr(4);
    else if (called.match(/TMSI/)) {
	var tmsi = called.substr(4);
	return getIMSI(tmsi);
    }
    return getIMSI(null,called);
}

/**
 * Add param osip_Authorization to call.execute message that will add 
 * Authorization header to INVITE request if authentication params are set
 * @param msg Object. Message where parameter is added
 */
function onExecute(msg)
{
    if ((msg.username||msg.tmsi)&&(msg["auth.response"]!=""||msg["auth.auts"]!=""))
	addAuthParams(msg,msg,msg.username,msg.tmsi,"osip_Authorization");

    return false;
}

/*
 * Read only necessary configuration from [gsm],[gsm_advanced] sections in ybts.conf
 */
function readYBTSConf()
{
    var conf = new ConfigFile(Engine.configFile("ybts"),true);
    var gsm_section = conf.getSection("gsm");

    mcc = gsm_section.getValue("Identity.MCC");
    mnc = gsm_section.getValue("Identity.MNC");

    var lac = gsm_section.getValue("Identity.LAC");
    var ci = gsm_section.getValue("Identity.CI");

    if (mcc=="" || mnc=="" || lac=="" || ci=="")
	Engine.alarm(alarm_conf, "Please configure Identity.MCC, Identity.MNC, Identity.LAC, Identity.CI in ybts.conf. All this parameters are required in roaming mode.");

    hex_lac = get16bitHexVal(lac);
    hex_ci = get16bitHexVal(ci);
    if (hex_lac==false || hex_ci==false)
	Engine.alarm(alarm_conf, "Wrong configuration for Identity.LAC="+lac+" or Identity.CI="+ci+". Can't hexify value.");

    var gsm_advanced = conf.getSection("gsm_advanced");
    if (gsm_advanced)
	t3212 = gsm_advanced.getValue("Timer.T3212");
   
    if (t3212 == undefined)
	t3212 = 1440; // defaults to 24 minutes
    else {
	t3212 = parseInt(t3212);
	if (isNaN(t3212))
	    Engine.alarm(alarm_conf, "Wrong configuration for Timer.T3212. Value is not numeric: '"+gsm_advanced.getValue("Timer.T3212")+"'");
	else
	    t3212 = t3212 * 60;
    }

    if (t3212 == 0)
	Engine.alarm(alarm_conf, "Incompatible configuration: Timer.T3212=0. When sending requests to SIP/IMS server Timer.T3212 is in 6..60 range.");

    accnet_header = "3GPP-GERAN; cgi-3gpp="+mcc+mnc+hex_lac+hex_ci+"; gstn-location=\""+gstn_location+"\"";
}

/*
 * Read registered subscribers. Should be called when script is started.
 * Function calls other functions based on tmsi_storage configuration to read users from various mediums: conf file/db
 */
function readUEs()
{
    if (tmsi_storage==undefined || tmsi_storage=="conf")
	readUEsFromConf();
}

/*
 * Read registered subscribers from tmsidata.conf configuration file 
 */
function readUEsFromConf()
{
    conf = new ConfigFile(Engine.configFile("tmsidata"),true);
    ues = conf.getSection("ues",true);
    var subscriber_info, imsi;
    subscribers = {};

    keys = ues.keys();
    var count_ues = 0;
    for (imsi of keys) {
	// Ex:226030182676743=000000bd,354695033561290,,1401097352
	// imsi=tmsi,imei,msisdn,expires
	subscriber_info = ues.getValue(imsi);
	subscriber_info = subscriber_info.split(",");
	var tmsi = subscriber_info[0];
	var imei = subscriber_info[1];
	var msisdn = subscriber_info[2];
	var expires = subscriber_info[3];
	var expires = parseInt(expires);
	subscribers[imsi] = {"tmsi":tmsi,"imei":imei,"msisdn":msisdn,"expires":expires};
	count_ues = count_ues+1;
    }

    Engine.debug(Engine.DebugInfo, "Finished reading saved subscribers. Found "+count_ues+" subscribers.");
}

/*
 * Check if modification were actually made and save modifications to subscribers storage
 * Function calls other functions based on tmsi_storage configuration to write subscribers to various mediums: conf file/db
 * @param imsi String
 * @param subscriber Object/undefined. If undefined them subscriber must be deleted
 */
function saveUE(imsi,subscriber)
{
    if (subscriber!=undefined) {
	if (subscriber[imsi]!=undefined) {
	    Engine.print_r(subscribers);	   
	    if (subscriber == subscribers[imsi]) {
		Engine.Debug(Engine.DebugInfo, "No change when updating subscriber info for IMSI "+imsi);
		return;
	    }
	}
    }

    if (tmsi_storage==undefined || tmsi_storage=="conf")
	saveUEinConf(imsi,subscriber)
}

/*
 * Save modifications to subscribers in tmsidata.conf configuration file 
 * @param imsi String
 * @param subscriber Object/undefined. If undefined them subscriber must be deleted
 */
function saveUEinConf(imsi,subscriber)
{
    if (subscriber!=undefined) {
	var fields = subscriber["tmsi"]+","+subscriber["imei"]+","+subscriber["msisdn"]+","+subscriber["expires"];
	conf.setValue(ues,imsi,fields);
    } else
	conf.clearKey(ues,imsi);

    if (conf.save()==false)
	Engine.alarm(4, "Could not save tmsi in tmsidata.conf");
}

/*
 * Update subscribers in memory and on storage medium
 * @param msg Object when to take subscriber parameters from
 */
function updateSubscribers(msg)
{
    var imsi = msg.imsi;
    if (imsi=="") {
	// this should not happen. If it does => BUG
	Engine.debug(Engine.debugWarn, "ERROR: got updateSubscribers with msg without imsi. tmsi='"+msg.tmsi+"'");
	return;
    }

    var imei = msg.imei;
    if (imei=="" && subscribers[imsi]!=undefined)
	imei = subscribers[imsi]["imei"];

    var expire_subscriber = Date.now()/1000 + imsi_cleanup;
    subscriber = {"tmsi":msg.tmsi, "msisdn":msg.msisdn, "imei":imei, "expires":expire_subscriber};
    subscribers[imsi] = subscriber;
    saveUE(imsi,subscriber);
}

/*
 * Returns 16 bit(or more) hex value
 * @param String String representation of int value that should be returned as hex
 * @return String representing the hex value of @val
 */ 
function get16bitHexVal(val)
{
    val = parseInt(val);
    if (isNaN(val))
	return false;

    val = val.toString(16);
    val = val.toString();
    while (val.length<4)
	val = "0"+val;

    return val;
}

/*
 * Check if there are subscribers that should be expired
 */
function onInterval()
{
    var now = Date.now() / 1000;

    for (var imsi in subscribers) {
	if (subscribers[imsi]["expires"]<now) {
	    Engine.debug(Engine.debugInfo, "Expiring subscriber "+imsi);
	    delete subscribers[imsi];
	    saveUE(imsi);
	}
    }
}

/*
 * Get adress where to send SIP request
 * @param tmsi String. Used only multiple registrars are available and nodes_sip and nnsf_bits are configured
 * @return String represening ip:port where to send SIP request or false in case of missing configurations
 */
function getSIPRegistrar(tmsi)
{
    var node;

    Engine.debug(Engine.DebugInfo, "Entered getSIPRegistrar() tmsi='"+tmsi+"', nnsf_mask='"+nnsf_mask+"'");
    if (nnsf_mask) {
	if (tmsi!="") {
	    var hex_tmsi = parseInt(tmsi,16);
	    if (isNaN(hex_tmsi)) {
		Engine.debug(Engine.debugWarn, "Could not hexify tmsi='"+tmsi+"'");
		return false;
	    }
	    var tmsi_node = (hex_tmsi>>(24-nnsf_bits))&nnsf_mask;
	    Engine.debug(Engine.DebugInfo,"Using SIP node='"+tmsi_node+"'");
	    if (nodes_sip[tmsi_node]!=undefined)
		return nodes_sip[tmsi_node];
	    else {
		node = randomNode();
		node = ov_nodes[node]["node"];
		Engine.debug(Engine.DebugInfo, "Could not find '"+tmsi_node+"' node computed from imsi in nodes_sip. Using random node from list:"+node);
		// this will probably trigger new register request without tmsi
		return nodes_sip[node];
	    }
	}

	if (last_used_node==undefined)
	    last_used_node = randomNode();

	last_used_node = last_used_node+1;
	if (last_used_node==ov_nodes.length)
	    last_used_node = 0;
	node = ov_nodes[last_used_node]["node"];

	Engine.debug(Engine.DebugInfo,"No tmsi. Using next node from list:"+node);
	return nodes_sip[node];
    }
    
    if (reg_sip!="" || reg_sip!=null)
	return reg_sip;

    Engine.debug(Engine.DebugWarn, "Please configure reg_sip or nodes_sip parameter in roamingconf.js located in the configurations directory.");
    return false;
}

function randomNode()
{
    var node = Math.random(0,ov_nodes.length);
    return node;
}

/*
 * Read and check configuration from roamingconf.js and ybts.conf
 */ 
function checkConfiguration()
{
    if (expires=="")
	expires = 3600;

    if (imsi_cleanup=="")
	imsi_cleanup = 3600 * 24;

    if (nodes_sip==undefined || typeof(nodes_sip)!="object") {
    	if (!reg_sip)
	    Engine.alarm(alarm_conf,"Please configure reg_sip or nodes_sip parameter in roamingconf.js located in the configurations directory.");
    } else {
	ov_nodes = [];
	var ov_node, ov_server;
	for (var node in nodes_sip) {
	    ov_server = nodes_sip[node];
	    ov_node = {"node":node,"server":ov_server};
	    ov_nodes.push(ov_node);
	}
	if (ov_nodes.length==0)
	    Engine.alarm(alarm_conf,"Please add SIP nodes in nodes_sip parameter in roamingconf.js located in the configurations directory.");
	else {
	    if (!nnsf_bits)
		Engine.alarm(alarm_conf,"Please configure nnsf_bits in roamingconf.js located in the configurations directory.");
	    else {
		nnsf_mask = 0x03ff >> (10-nnsf_bits);
		Engine.debug(Engine.debugInfo, "Computed nnsf_mask="+nnsf_mask);
	    }
        }
    }
    if (!my_sip)
	Engine.alarm(alarm_conf,"Please configure my_sip parameter in roamingconf.js located in the configurations directory.");
    if (!gstn_location)
	Engine.alarm(alarm_conf,"Please configure gstn_location parameter in roamingconf.js located in the configurations directory.");

    readYBTSConf();
    readUEs();
}

// hold temporary info: nonce and realm for authenticating various requests
var tempinfo = {};
// hold temporary chanid-imsi association for authenticating INVITEs
var tempinfo_route = {};
// alarm for configuration issues
var alarm_conf = 3;
// hold current MO calls
var current_calls = {};

register_translations = {
	"500":"network-failure",				// Server Internal Error 
	"410":"IMSI-unknown-in-HLR",				// Gone
	"403":"illegal-MS",					// Fornidden
	"488":"roaming-not-allowed-in-this-location-area",	// Not Acceptable Here 
	"503":"protocol-error-unspecified"			// Service Unavailable
};

mosms_translations = {
	"415":"127",	// Unsupported Media Type => Interworking 
	"403":"29",	// Forbidden =>  Facility rejected
	"488":"127",	// Not Acceptable Here => Interworking
	"502":"38", 	// Bad Gateway => Network out of order 
	"480":"41"	// Temporarily Unavailable => Temporary failure  
};


Engine.debugName("roaming");
Message.trackName(Engine.debugName());
checkConfiguration();
Message.install(onRegister,"user.register",80);
Message.install(onUnregister,"user.unregister",80);
Message.install(onRoute,"call.route",80);
Message.install(onAuth,"auth",80);
Message.install(onMoSMS,"msg.execute",80,"callto","smsc_yatebts");
Message.install(onDisconnected,"chan.disconnected",40);
Message.install(onHangup,"chan.hangup",80);
Message.install(onExecute,"call.execute",80);
Message.install(addPhyInfo,"call.progress",50,"module","ybts");
Message.install(addPhyInfo,"call.ringing",50,"module","ybts");
Message.install(addPhyInfo,"call.answered",50,"module","ybts");
Message.install(addPhyInfo,"chan.dtmf",50,"module","ybts");

Engine.setInterval(onInterval,60000);

