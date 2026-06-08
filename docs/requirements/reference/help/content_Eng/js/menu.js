
function DynLayer(id,nestref,frame) {
	//if (!is.ns5 && !DynLayer.set && !frame) DynLayerInit()
	if (!DynLayer.set && !frame) DynLayerInit() 
	this.frame = frame || self
	if (is.ns) {
		if (is.ns4) {
			if (!frame) {
				if (!nestref) var nestref = DynLayer.nestRefArray[id]
				if (!DynLayerTest(id,nestref)) return
				this.css = (nestref)? eval("document."+nestref+".document."+id) : document.layers[id]
			}
			else this.css = (nestref)? eval("frame.document."+nestref+".document."+id) : frame.document.layers[id]
			this.elm = this.event = this.css
			this.doc = this.css.document
		}
		else if (is.ns5) {
			this.elm = this.frame.document.getElementById(id) 
			this.event = this.elm
			this.css = this.elm.style
			this.doc = document 
			//this.doc = this.elm 
		}
		if (is.ns4)	{
			this.x = this.css.left 
			this.y =  this.css.top
			this.w = this.css.clip.width 
			this.h =  this.css.clip.height
		}
		else if (is.ns5){
			var parent = this.elm.parentNode
			p = (parent.constructor.toString().indexOf('HTMLDivElement')>-1) ? parent : null
			this.x = (p) ? p.offsetLeft-this.elm.offsetLeft  : this.elm.offsetLeft
			this.y = (p) ? p.offsetTop - this.elm.offsetTop  : this.elm.offsetTop
			this.w =  this.elm.offsetWidth
			this.h =  this.elm.offsetHeight
		}
		/*
		this.x = (is.ns4) ? this.css.left : this.elm.offsetLeft
		this.y = (is.ns4) ? this.css.top : this.elm.offsetTop
		this.w = (is.ns4) ? this.css.clip.width : this.elm.offsetWidth
		this.h = (is.ns4) ? this.css.clip.height : this.elm.offsetHeight
		*/
		
	}
	else if (is.ie) {
		this.elm = this.event = this.frame.document.all[id]
		this.css = this.frame.document.all[id].style
		this.doc = document
		this.x = this.elm.offsetLeft
		this.y = this.elm.offsetTop
		this.w = (is.ie4)? this.css.pixelWidth : this.elm.offsetWidth
		this.h = (is.ie4)? this.css.pixelHeight : this.elm.offsetHeight
	}
	this.id = id
	this.nestref = nestref
	if (is.ie55)	
		this.css.backgroundImage ="url(javascript:null)" 
	this.obj = id + "DynLayer"
	eval(this.obj + "=this")
}
function DynLayerMoveTo(x,y) {
	if (x!=null) {
		this.x = x
		if (is.ns) this.css.left = this.x
		else this.css.pixelLeft = this.x
	}
	if (y!=null) {
		this.y = y
		if (is.ns) this.css.top = this.y
		else this.css.pixelTop = this.y
	}
}
function DynLayerMoveBy(x,y) {
	this.moveTo(this.x+x,this.y+y)
}
function DynLayerShow() {
	this.css.visibility = (is.ns4)? "show" : "visible"
}
function DynLayerHide() {
	this.css.visibility = (is.ns4)? "hide" : "hidden"
}
DynLayer.prototype.moveTo = DynLayerMoveTo
DynLayer.prototype.moveBy = DynLayerMoveBy
DynLayer.prototype.show = DynLayerShow
DynLayer.prototype.hide = DynLayerHide
DynLayerTest = new Function('return true')

function DynLayerInit(nestref) {
	if (!DynLayer.set) DynLayer.set = true
	// if (is.ns) 
	if (is.ns4) { 
		if (nestref) ref = eval('document.'+nestref+'.document')
		else {nestref = ''; ref = document;}
		for (var i=0; i<ref.layers.length; i++) {
			var divname = ref.layers[i].name
			DynLayer.nestRefArray[divname] = nestref
			var index = divname.indexOf("Div")
			if (index > 0) {
				eval(divname.substr(0,index)+' = new DynLayer("'+divname+'","'+nestref+'")')
			}
			if (ref.layers[i].document.layers.length > 0) {
				DynLayer.refArray[DynLayer.refArray.length] = (nestref=='')? ref.layers[i].name : nestref+'.document.'+ref.layers[i].name
			}
		}
		if (DynLayer.refArray.i < DynLayer.refArray.length) {
			DynLayerInit(DynLayer.refArray[DynLayer.refArray.i++])
		}
	}
	else if (is.ns5) { 
		if (is.ns5){
			var els = document.getElementsByTagName('DIV')
			var elslen = els.length
			for (var i=0; i<elslen; i++) {
				var divname = els[i].id
				var index = divname.indexOf("Div")
				if (index > 0) {
					eval(divname.substr(0,index)+' = new DynLayer("'+divname+'")')
				}
			}
		}
	}				
	else if (is.ie) {
		for (var i=0; i<document.all.tags("DIV").length; i++) {
			var divname = document.all.tags("DIV")[i].id
			var index = divname.indexOf("Div")
			if (index > 0) {
				eval(divname.substr(0,index)+' = new DynLayer("'+divname+'")')
			}
		}
	}
	return true
}
DynLayer.nestRefArray = new Array()
DynLayer.refArray = new Array()
DynLayer.refArray.i = 0
DynLayer.set = false

// Slide Methods
function DynLayerSlideTo(endx,endy,inc,speed,fn) {
	if (endx==null) endx = this.x
	if (endy==null) endy = this.y
	var distx = endx-this.x
	var disty = endy-this.y
	this.slideStart(endx,endy,distx,disty,inc,speed,fn)
}
function DynLayerSlideBy(distx,disty,inc,speed,fn) {
	var endx = this.x + distx
	var endy = this.y + disty
	this.slideStart(endx,endy,distx,disty,inc,speed,fn)
}
function DynLayerSlideStart(endx,endy,distx,disty,inc,speed,fn) {
	if (this.slideActive) return
	if (!inc) inc = 10
	if (!speed) speed = 20
	var num = Math.sqrt(Math.pow(distx,2) + Math.pow(disty,2))/inc
	if (num==0) return
	var dx = distx/num
	var dy = disty/num
	if (!fn) fn = null
	this.slideActive = true
	this.slide(dx,dy,endx,endy,num,1,speed,fn)
}
function DynLayerSlide(dx,dy,endx,endy,num,i,speed,fn) {
	if (!this.slideActive) return
	if (i++ < num) {
		this.moveBy(dx,dy)
		this.onSlide()
		if (this.slideActive) setTimeout(this.obj+".slide("+dx+","+dy+","+endx+","+endy+","+num+","+i+","+speed+",\""+fn+"\")",speed)
		else this.onSlideEnd()
	}
	else {
		this.slideActive = false
		this.moveTo(endx,endy)
		this.onSlide()
		this.onSlideEnd()
		eval(fn)
	}
}
function DynLayerSlideInit() {}
DynLayer.prototype.slideInit = DynLayerSlideInit
DynLayer.prototype.slideTo = DynLayerSlideTo
DynLayer.prototype.slideBy = DynLayerSlideBy
DynLayer.prototype.slideStart = DynLayerSlideStart
DynLayer.prototype.slide = DynLayerSlide
DynLayer.prototype.onSlide = new Function()
DynLayer.prototype.onSlideEnd = new Function()

// Clip Methods
function DynLayerClipInit(clipTop,clipRight,clipBottom,clipLeft) {
	this.clipTo = DynLayerClipTo
	this.clipBy = DynLayerClipBy
	this.clipValues = DynLayerClipValues
//	if (is.ie) {			 
	if (is.ie || is.ns5) {	 
		if (arguments.length==4) this.clipTo(clipTop,clipRight,clipBottom,clipLeft)
		else if (is.ie4) this.clipTo(0,this.css.pixelWidth,this.css.pixelHeight,0)
	}
	else if (is.ns4)		
		this.clipTo(clipTop,clipRight,clipBottom,clipLeft)
}
function DynLayerClipTo(t,r,b,l) {
	if (t==null) t = this.clipValues('t')
	if (r==null) r = this.clipValues('r')
	if (b==null) b = this.clipValues('b')
	if (l==null) l = this.clipValues('l')
//	if (is.ns) {			 
	if (is.ns4){			 
		this.css.clip.top = t
		this.css.clip.right = r
		this.css.clip.bottom = b
		this.css.clip.left = l
	}
//	else if (is.ie)			 
	else if (is.ie || is.ns5)// с NN 6 30.08.00 AT 
		this.css.clip = "rect("+t+"px "+r+"px "+b+"px "+l+"px)"
}
function DynLayerClipBy(t,r,b,l) {
	this.clipTo(this.clipValues('t')+t,this.clipValues('r')+r,this.clipValues('b')+b,this.clipValues('l')+l)
}
function DynLayerClipValues(which) {
//	if (is.ie)				// Исправления для работы 
	if (is.ie || is.ns5)	// с NN 6 30.08.00 AT 
		var clipv = this.css.clip.split("rect(")[1].split(")")[0].split("px")
/*	
							
							 
	if (which=="t") return (is.ns)? this.css.clip.top : Number(clipv[0])
	if (which=="r") return (is.ns)? this.css.clip.right : Number(clipv[1])
	if (which=="b") return (is.ns)? this.css.clip.bottom : Number(clipv[2])
	if (which=="l") return (is.ns)? this.css.clip.left : Number(clipv[3])
*/
	 
	if (which=="t") return (is.ns4)? this.css.clip.top : Number(clipv[0])
	if (which=="r") return (is.ns4)? this.css.clip.right : Number(clipv[1])
	if (which=="b") return (is.ns4)? this.css.clip.bottom : Number(clipv[2])
	if (which=="l") return (is.ns4)? this.css.clip.left : Number(clipv[3])
	
}
DynLayer.prototype.clipInit = DynLayerClipInit
DynLayer.prototype.clipTo = DynLayerClipTo
DynLayer.prototype.clipBy = DynLayerClipBy
DynLayer.prototype.clipValues = DynLayerClipValues

// Write Method
function DynLayerWrite(html) {
	if (is.ie) {
		this.event.innerHTML = html
	}
	//if (is.ns) {
	else if (is.ns4) {	
		this.doc.open()
		this.doc.write(html)
		this.doc.close()
	}
	else if (is.ns5)	{
		var elm = this.elm 
		while (elm.hasChildNodes())  		
			elm.removeChild(elm.firstChild)
		var owner = elm.ownerDocument
		var range = owner.createRange()
		range.selectNodeContents(elm)
		range.collapse(true)
		var docfrag = range.createContextualFragment(html)
		elm.appendChild(docfrag)
		this.moveBy(1)
		this.moveBy(-1)
	}
}
DynLayer.prototype.write = DynLayerWrite

function BrowserCheck() {
	var b = navigator.appName
	if (b=="Netscape") this.b = "ns"
	else if (b=="Microsoft Internet Explorer") this.b = "ie"
	else this.b = b
	this.version = navigator.appVersion
	if (this.b=='ie'){ // Internet Explorer возвращает '4.0 (compatible; MSIE 5.5...'
		var ve = this.version.indexOf("MSIE")
		this.v = parseInt(this.version.substr(ve+4))
	}
	else this.v = parseInt(this.version)
	this.ns = (this.b=="ns" && this.v>=4)
	this.ns4 = (this.b=="ns" && this.v==4)
	this.ns5 = (this.b=="ns" && this.v==5)
	this.ie = (this.b=="ie" && this.v>=4)
	this.ie4 = (this.version.indexOf('MSIE 4')>0)
	this.ie5 = (this.version.indexOf('MSIE 5')>0)
	this.ie55 = (this.version.indexOf('MSIE 5.5')>0) // AT 05.11.00
	this.min = (this.ns||this.ie)
}
is = new BrowserCheck()
// CSS Function
function css(id,left,top,width,height,color,vis,z,other) {
	if (id=="START") return '<STYLE TYPE="text/css">\n'
	else if (id=="END") return '</STYLE>'
	var str = (left!=null && top!=null)? '#'+id+' {position:absolute; left:'+left+'px; top:'+top+'px;' : '#'+id+' {position:relative;'
	if (arguments.length>=4 && width!=null) str += ' width:'+width+'px;'
	if (arguments.length>=5 && height!=null) {
		str += ' height:'+height+'px;'
		if (arguments.length<9 || other.indexOf('clip')==-1) str += ' clip:rect(0px '+width+'px '+height+'px 0px);'
	}
	if (arguments.length>=6 && color!=null) str += (is.ns4)? ' layer-background-color:'+color+';' : ' background-color:'+color+';'
	if (arguments.length>=7 && vis!=null) str += ' visibility:'+vis+';'
	if (arguments.length>=8 && z!=null) str += ' z-index:'+z+';'
	if (arguments.length==9 && other!=null) str += ' '+other
	str += '}\n'
	return str
}
function writeCSS(str,showAlert) {
	str = css('START')+str+css('END')
	document.write(str)
	if (showAlert) alert(str)
}

function preload(imgObj,imgSrc) {
	if (document.images) {
		eval(imgObj+' = new Image()')
		eval(imgObj+'.src = "'+imgSrc+'"')
	}
}
function changeImage(layer,imgName,imgObj) {
	if (document.images) {
		if (document.layers && layer!=null) eval('document.'+layer+'.document.images["'+imgName+'"].src = '+imgObj+'.src')
		else document.images[imgName].src = eval(imgObj+".src")
	}
}

function toc(								
	x,										
	y,
	Toc,									
	Target,					
											
	TooltipDelay,																
																				
	Path									
){	
	this.ITEMHEIGHT = 22					
	this.ITEMSHIFT =16						
	this.NUL = -1
	this.LEVEL = 0							
	this.TEXT = 1							
	this.URL = 2							
	this.PARENT = 3							
	this.LASTNODE = 4						
	this.FOLDER = 5							
	this.ID =6
	this.YPOS = 7
	this.ISCLOSED = 8
	this.ISVISIBLE = 9
	this.Sel=-1


	this.TOCX0 = x ? x : TOCX0
	this.TOCY0 = y ? y : TOCY0
	this.TOC = Toc ? Toc : TOC
	this.target = Target ? Target : 'right'
	this.TOOLTIPDELAY = TooltipDelay ? TooltipDelay : 1000
	TOOLTIPDELAY = this.TOOLTIPDELAY		
	this.PATH = Path ? Path : ''
	this.name = 'toc'+(toc.count++)
	this.pref = this.name					

	this.obj = this.name + "Object"
	eval(this.obj + "=this")


	this.maxlevel = this.NUL				
	var elements = this.TOC.length			
	var i, j, k, level, prev, next
	this.parents = new Array()
	this.levels = new Array()
	var parent								
	var s
	var Id									
	var YY = 0								

	for (i=0; i < elements; i++) {
		level = this.TOC[i][this.LEVEL]
		this.maxlevel = this.maxlevel < level ? level : this.maxlevel
	}
	for (i=0; i <= this.maxlevel; i++){
		this.parents[i] = this.NUL
		this.levels[i] = this.NUL
	}
	this.TOC[0][this.PARENT] = this.NUL
	this.TOC[0][this.LASTNODE] = true
	this.TOC[0][this.FOLDER] = true
	this.levels[0] = 0
	for (i=1; i < elements; i++){
		prev = this.TOC[i-1][this.LEVEL]	
		level = this.TOC[i][this.LEVEL]
		if (level > prev){			
			this.parents[level] = i - 1
			this.levels[level] = i
		}
		this.TOC[i][this.PARENT] =		
			this.parents[level]
		this.TOC[i][this.LASTNODE] = false
		this.TOC[i][this.FOLDER] = false
		if (i==(elements-1)) {
			this.TOC[i][this.LASTNODE] = true
		}	
		else {
			next = this.TOC[i+1][this.LEVEL]
			this.TOC[i][this.FOLDER] = (level == (next-1))
			if (level > next){
				k = i
				for(j=level;j>next;j--){
					this.TOC[k][this.LASTNODE] = true
					k=this.parents[j]
				}
			}
			if(level<next){
				var l = true
				for (j=i+1;j<elements ;j++ ){
					if(this.TOC[j][this.LEVEL]==level){
						l = false
						break
					}
				}
				if(l) this.TOC[i][this.LASTNODE] = true
			}
		}
	}
	this.build = tocBuild
	this.prepare = tocPrepare
	this.activate = tocActivate
}
toc.count = 0

function tocBuild(){
	this.css =""
	var s = ''
	this.div=""
	this.scripts = "<S"+'CRIPT LANGUAGE="JavaScript">\n'
	var elements = this.TOC.length
	for (i=0; i < elements; i++){
		Id = this.pref + i
		level = this.TOC[i][this.LEVEL]
		s += '<DIV CLASS="TOC" ID="' + Id + '">\n'
		s +='<TABLE BORDER=0 CELLSPACING=0 CELLPADDING=0 width=100% ID="'+Id+'Sel"><TR HEIGHT='+this.ITEMHEIGHT+ '>\n'
		if (i==0)	{
			s+='<TD WIDTH='+this.ITEMSHIFT +'><A HIDEFOCUS="true" HREF="javascript:'+this.obj
			s+='.ClickOnFolder('+i+')"><IMG SRC="'+this.PATH+'img/toc/tocclosedfolder.gif" BORDER=0 '+ 
			'NAME="'+Id +'Folder"></A></TD>\n'
		}
		else {
			for (j=0; j <= this.maxlevel; j++){this.parents[j]=false}
			k = this.TOC[i][this.PARENT]
			for (j = 1; j<level; j++){
				this.parents[this.TOC[k][this.LEVEL]] = this.TOC[k][this.LASTNODE]
				k = this.TOC[k][this.PARENT]
			}
			for (j=1; j < this.TOC[i][this.LEVEL];j++)	{
				if (this.parents[j]) s+='<TD WIDTH='+this.ITEMSHIFT +'><IMG SRC="'+this.PATH+'img/toc/tocblank.gif" BORDER=0></TD>\n'
				else s+='<TD WIDTH='+this.ITEMSHIFT +'><IMG SRC="'+this.PATH+'img/toc/tocvert.gif" BORDER=0></TD>\n'
			}
			if (this.TOC[i][this.LASTNODE]){
				if (this.TOC[i][this.FOLDER]){
					s +='<TD WIDTH='+this.ITEMSHIFT +'>'
					s +='<A HIDEFOCUS="true" HREF="javascript:'+this.obj+'.ClickOnFolder('+ i +')">'
					s +='<IMG SRC="'+this.PATH+'img/toc/tocpluslastnode.gif" BORDER=0 '+
					'NAME="'+ Id +'PM"></A></TD>\n'
					s +='<TD WIDTH='+this.ITEMSHIFT +'>'
					s +='<A HIDEFOCUS="true" HREF="javascript:'+this.obj+'.ClickOnFolder('+ i +')">'
					s +='<IMG SRC="'+this.PATH+'img/toc/tocclosedfolder.gif" BORDER=0 '+
					'NAME="'+ Id +'Folder"></A></TD>\n'
				}
				else{
					s +='<TD WIDTH='+this.ITEMSHIFT +'><IMG SRC="'+this.PATH+'img/toc/toclastnode.gif" BORDER=0></TD>\n'
					s +='<TD WIDTH='+this.ITEMSHIFT +'><IMG SRC="'+this.PATH+'img/toc/toclink.gif" BORDER=0></TD>\n'
				}
			}
			else{
				if (this.TOC[i][this.FOLDER]){
					s +='<TD WIDTH='+this.ITEMSHIFT +'>'
					s +='<A HIDEFOCUS="true" HREF="javascript:'+this.obj+'.ClickOnFolder('+ i +')">'
					s +='<IMG SRC="'+this.PATH+'img/toc/tocplusnode.gif" BORDER=0 '+
					'NAME="' + Id +'PM"></A></TD>\n'
					s +='<TD WIDTH='+this.ITEMSHIFT +'>'
					s +='<A HIDEFOCUS="true" HREF="javascript:'+this.obj+'.ClickOnFolder('+ i +')">'
					s +='<IMG SRC="'+this.PATH+'img/toc/tocclosedfolder.gif" BORDER=0 '+
					'NAME="' + Id +'Folder"></A></TD>\n'
				}
				else{
					s +='<TD WIDTH='+this.ITEMSHIFT +'><IMG SRC="'+this.PATH+'img/toc/tocnode.gif" BORDER=0></TD>\n'
					s +='<TD WIDTH='+this.ITEMSHIFT +'><IMG SRC="'+this.PATH+'img/toc/toclink.gif" BORDER=0></TD>\n'
				}
			}			
		}		
		s+='<TD  CLASS="TOCITEM" VALIGN=MIDDLE NOWRAP ondblclick="'+this.obj+'.DABDblClick('+i+')" onClick="'+this.obj+'.DABClick('+i+')">'
		if ((this.TOC[i][this.URL]!=null) && (this.TOC[i][this.URL]!="")) {
			s+='<A HIDEFOCUS="true" HREF="' + this.TOC[i][this.URL] + '" onClick=parent.delay()'
			if (this.target!="") s+=' TARGET="'+this.target+'" '
			s+='>'
		}
//		s += '<font color="#ffffff">'+this.TOC[i][this.TEXT]+"</font>"
		s += this.TOC[i][this.TEXT]+""
		if (this.TOC[i][this.URL]!="") s+='</A>'
		s+='</TD></TR></TABLE></DIV>\n'
		
		this.scripts +=
		 'var ' + Id + ' = new DynLayer("' + Id + '");\n'
		this.TOC[i][this.ID]= Id 
		if (this.TOC[i][this.PARENT]==this.NUL) YY = this.TOCY0
		else YY=0
		this.TOC[i][this.YPOS]= YY
		this.TOC[i][this.ISCLOSED] = true
		this.TOC[i][this.ISVISIBLE] = false
		this.scripts += Id + '.moveTo('+this.TOCX0+', '+ YY + ');\n'

		YY +=this.ITEMHEIGHT
		if (this.TOOLTIPDELAY>=0) {
			s += '<DIV CLASS="TOOLTIP" ID="' + Id + 'TP">' + this.TOC[i][this.TEXT]
			s += '</DIV>\n '
			this.scripts += 'var ' + Id + 'TP = new DynLayer("'+Id + 'TP")\n'		
			this.scripts += Id + '.elm.onmousemove = ItemMouseMove\n'
			this.scripts += Id + '.elm.onmouseout = ItemMouseOut\n'
			this.scripts += 'if (is.ns4) ' + Id + '.elm.captureEvents(Event.MOUSEMOVE)\n'
		}
	 }
	 this.div = s 
	 this.scripts +=
	'\n'+this.obj+'.prepare()'+	
	 "\n</SCRIPT>"
}													

function tocClickOnFolder(i){
	if (this.TOC[i][this.ISCLOSED])
		this.OpenFolder(i)
	else 
		this.CloseFolder(i)
	this.changeFolderState(i)
}
toc.prototype.ClickOnFolder=tocClickOnFolder 

function tocDABSelect(no) {
	if(this.Sel>=0) {
		id=this.TOC[this.Sel][this.ID]
		document.all(id+'Sel').bgColor=""
	}

	this.Sel=no
	id=this.TOC[no][this.ID]
	document.all(id+'Sel').bgColor="#1F3847"

	var pl=new Array()
	var p=this.TOC[no][this.PARENT];
	var cnt=0
	var i
	while(p!=this.NUL && p!=0) {
		pl[cnt]=p
		cnt=cnt+1
		p=this.TOC[p][this.PARENT];
	}
	for(i=cnt-1;i>=0;i--) {
		if (this.TOC[pl[i]][this.ISCLOSED]) {
			this.OpenFolder(pl[i])
			this.changeFolderState(pl[i])
		}
	}

	id=this.TOC[no][this.ID]
	obj=document.all(id)
	if((obj.offsetTop-document.body.scrollTop)<0 || (obj.offsetTop-document.body.scrollTop+this.ITEMHEIGHT)>document.body.clientHeight) {
		obj.scrollIntoView(false)
	}
}
toc.prototype.DABSelect=tocDABSelect

function tocDABSlectByUrl(str) {
	var elements = this.TOC.length
	var i
	for (i=0; i < elements; i++){
		if(str.indexOf('/'+this.TOC[i][this.URL])>0) {
			this.DABSelect(i)
			break
		}
	}
}
toc.prototype.DABSelectByUrl=tocDABSlectByUrl

function tocDABClick(i) {
	if(this.TOC[i][this.URL]!=null && this.TOC[i][this.URL]!="") {
		parent.delay()
		open(this.TOC[i][this.URL],this.target)
	}
}
toc.prototype.DABClick=tocDABClick

function tocDABDblClick(i) {
	if(this.TOC[i][this.FOLDER]) {
		if(!this.TOC[i][this.ISCLOSED]) {
			this.CloseFolder(i)
			this.changeFolderState(i)
		} else {
			this.OpenFolder(i)
			this.changeFolderState(i)
		}
	}
}
toc.prototype.DABDblClick=tocDABDblClick

function tocOpenFolder(I)	{
	var i, k = -1
	var l = this.TOC[I][this.LEVEL]	
	var l1 = l +1
	var Y = this.TOC[I][this.YPOS]	
	
	for (i=I+1;i<this.TOC.length; i++ ){
		var li = this.TOC[i][this.LEVEL]
		if (li==l) break
		else {
			if (li==l1){
				Y += this.ITEMHEIGHT
				this.setY(i,Y)	
				this.changeVisibility(i)
				k = i
			}
		}
	}
	if (k>=0)
		for (i= k+1; i<this.TOC.length; i++ ){
			if (this.isVisible(i)){
				Y += this.ITEMHEIGHT
				this.setY(i,Y)
			}
		}
}
toc.prototype.OpenFolder=tocOpenFolder

function tocCloseFolder(I)	{
	var i, k = -1
	var l = this.getLevel(I)
	var l1 = l +1
	var Y = this.getY(I)
	for (i=I+1;i<this.TOC.length; i++ ){
		var li = this.getLevel(i)
		var Id = this.getId(i)
		FolderImg = this.getId(i)+'Folder'
		PMImg =this.getId(i) +'PM'
		if (li<=l) break
		else {
			if(this.isFolder(i) && !this.isClosed(i))
				this.changeFolderState(i)
			if (this.isVisible(i)){	
				this.changeVisibility(i)
				k = i
			}
		}
	}
	if (k>=0)	
		for (i= I+1; i<this.TOC.length; i++ ){
			if (this.isVisible(i)){
				Y += this.ITEMHEIGHT
				this.setY(i,Y)
			}
		}

	for (i=0;i<this.TOC.length; i++ ){
		if (!this.isVisible(i)) this.setY(i,0)
	}
}
toc.prototype.CloseFolder=tocCloseFolder

function tocPreloadImages( 
	path
	){				
	var i, point 
	var Id
	var src
	if(!path) path=''
	for (i=1; i<tocPreloadImages.arguments.length; i++) {
		src =tocPreloadImages.arguments[i]
		point = src.indexOf('.')
		Id = point ? src.substr(0, point) : src
		preload(Id, path + src)
	}
}

function tocPrepare(){	
	var Path = this.PATH+ 'img/toc'
	tocPreloadImages(Path+'/',
		'tocblank.gif',
		'tocclosedfolder.gif',
		'tocdoc.gif',
		'toclastnode.gif',
		'toclink.gif',
		'tocminuslastnode.gif',
		'tocminusnode.gif',
		'tocnode.gif',
		'tocopenfolder.gif',
		'tocpluslastnode.gif',
		'tocplusnode.gif',
		'tocvert.gif'
	)
}

function tocActivate(){
	this.changeVisibility(0)
	this.ClickOnFolder(0)
}

function TocgetLevel(i){
	return this.TOC[i][this.LEVEL]
}
toc.prototype.getLevel = TocgetLevel

function TocgetId(i) {	
	return this.TOC[i][this.ID]
}
toc.prototype.getId = TocgetId


function TocIsLastNode(i) {
	return this.TOC[i][this.LASTNODE]
}
toc.prototype.isLastNode = TocIsLastNode

function TocisFolder(i) {
	return this.TOC[i][this.FOLDER]
}
toc.prototype.isFolder = TocisFolder

function TocgetY(i) {
	return this.TOC[i][this.YPOS]
}
toc.prototype.getY =  TocgetY

function tocisClosed(i) {
	return this.TOC[i][this.ISCLOSED]
}
toc.prototype.isClosed =  tocisClosed

function tocisVisible(i) {
	return this.TOC[i][this.ISVISIBLE]
}
toc.prototype.isVisible =  tocisVisible

function tocsetY(i,Y){
	var id = this.TOC[i][this.ID]
	eval(id+'.moveTo('+this.TOCX0+', '+Y+')')
	this.TOC[i][this.YPOS]	= Y
}
toc.prototype.setY =  tocsetY

function tocchangeFolderState(i){
	var id = this.getId(i)
	var FolderImg = id +'Folder'
	var PMImg =id +'PM'
	if (this.isClosed(i)){	
		changeImage(id, FolderImg, 'tocopenfolder')
		if (this.getLevel(i)>0){
			if (this.isLastNode(i)) changeImage(id, PMImg, 'tocminuslastnode')
			else changeImage(id, PMImg, 'tocminusnode')
		}
		this.TOC[i][this.ISCLOSED] = false 
	}
	else {	
		changeImage(id, FolderImg, 'tocclosedfolder')
		if (this.getLevel(i)>0){
			if (this.isLastNode(i)) changeImage(id, PMImg, 'tocpluslastnode')
			else changeImage(id, PMImg, 'tocplusnode')
		}
		this.TOC[i][this.ISCLOSED] = true 
	}
}
toc.prototype.changeFolderState =  tocchangeFolderState

function tocchangeVisibility(i){
	var v = this.TOC[i][this.ISVISIBLE]
	var id = this.getId(i)
	if (v) eval(id+'.hide()')
	else eval(id+'.show()')
	this.TOC[i][this.ISVISIBLE] = v ? false : true
}
toc.prototype.changeVisibility =  tocchangeVisibility
