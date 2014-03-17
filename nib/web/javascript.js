
function getInternetExplorerVersion()
// Returns the version of Internet Explorer or a -1
// (indicating the use of another browser).
{
  var rv = -1; // Return value assumes failure.
  if (navigator.appName == 'Microsoft Internet Explorer')
  {
    var ua = navigator.userAgent;
    var re  = new RegExp("MSIE ([0-9]{1,}[\.0-9]{0,})");
    if (re.exec(ua) != null)
      rv = parseFloat( RegExp.$1 );
  }
  return rv;
}

function form_for_gateway(gwtype)
{
	//var sprot = document["forms"]["outbound"][gwtype+"protocol"];
	var sprot = document.getElementById(gwtype+"protocol");
	var sprotocol = sprot.options[sprot.selectedIndex].value || sprot.options[sprot.selectedIndex].text;
	var protocols = new Array("sip", "h323", "iax", "pstn", "BRI", "PRI");
	var i;
	var currentdiv;
	var othergw;

	if(gwtype == "reg")
		othergw = "noreg";
	else
		othergw = "reg";

	for(var i=0; i<protocols.length; i++) 
	{
		currentdiv = document.getElementById("div_"+gwtype+"_"+protocols[i]);
		if(currentdiv == null)
			continue;
		if(currentdiv.style.display == "block")
			currentdiv.style.display = "none";
	}
	for(var i=0; i<protocols.length; i++) 
	{
		currentdiv = document.getElementById("div_"+othergw+"_"+protocols[i]);
		if(currentdiv == null)
			continue;
		if(currentdiv.style.display == "block")
			currentdiv.style.display = "none";
	}
	currentdiv = document.getElementById("div_"+gwtype+"_"+sprotocol);
	if(currentdiv == null)
		return false;
	if(currentdiv.style.display == "none")
		currentdiv.style.display = "block";
}

function advanced(identifier)
{
	var elems = document.outbound.elements;
	var elem_name;
	var elem;

	var ie = getInternetExplorerVersion();

	for(var i=0;i<elems.length;i++)
	{
		elem_name = elems[i].name;
		if(identifier.length < elem_name.length && elem_name.substr(0,identifier.length) != identifier)
			continue;
		var elem = document.getElementById("tr_"+elem_name); 

		if(elem == null)
			continue;
		if(elem.style.display == null || elem.style.display == "")
			continue;
		if(elem.style.display == "none")
			elem.style.display = (ie > 1 && ie < 8) ? "block" : "table-row";
		else
			// specify the display property (the elements that are not advanced will have display="")
			if(elem.style.display == "block" || elem.style.display == "table-row")
				elem.style.display = "none";
	}

	var img = document.getElementById(identifier+"xadvanced");
	var imgsrc= img.src;
	var imgarray = imgsrc.split("/");
	if(imgarray[imgarray.length - 1] == "advanced.jpg"){
		imgarray[imgarray.length - 1] = "basic.jpg";
		img.title = "Hide advanced fields";
	}else{
		imgarray[imgarray.length - 1] = "advanced.jpg";
		img.title = "Show advanced fields";
	}

	img.src = imgarray.join("/");
}
/*
function advanced(identifier)
{
	var form = document.getElementById(identifier);
	var elems = form.elements;
	var elem_name;
	var elem;

	var ie = getInternetExplorerVersion();

	for(var i=0;i<elems.length;i++)
	{
		elem_name = elems[i].name;
		if(identifier.length > elem_name.length && elem_name.substr(0,identifier.length) != identifier)
			continue;
		var elem = document.getElementById("tr_"+elem_name); 
		if(elem == null)
			continue;
		if(elem.style.display == null || elem.style.display == "")
			continue;
		if(elem.style.display == "none")
			elem.style.display = (ie > 1 && ie < 8) ? "block" : "table-row";
		else
			// specify the display property (the elements that are not advanced will have display="")
			if(elem.style.display == "block" || elem.style.display == "table-row")
				elem.style.display = "none";
	}

	var img = document.getElementById(identifier+"xadvanced");
	var imgsrc= img.src;
	var imgarray = imgsrc.split("/");
	if(imgarray[imgarray.length - 1] == "advanced.jpg"){
		imgarray[imgarray.length - 1] = "basic.jpg";
		img.title = "Hide advanced fields";
	}else{
		imgarray[imgarray.length - 1] = "advanced.jpg";
		img.title = "Show advanced fields";
	}

	img.src = imgarray.join("/");
}*/