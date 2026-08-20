(function(){
  'use strict';

  var poster=document.getElementById('peakMap');
  var list=document.getElementById('peakList');
  var stats=document.getElementById('statsPane');
  var locationMap=document.getElementById('peakLocationMap');
  var ranges=['Sawatch','San Juan','Sangre de Cristo','Elk','Front','Tenmile-Mosquito'];
  var rangePhotos={
    'Sawatch':{src:'assets/ranges/sawatch.jpg',credit:'Ken Lund · CC BY-SA 2.0',source:'https://commons.wikimedia.org/wiki/File:Sawatch_Range,_Colorado_(9179290079).jpg'},
    'San Juan':{src:'assets/ranges/san-juan.jpg',credit:'Alan Levine · CC0',source:'https://commons.wikimedia.org/wiki/File:San_Juan_Mountains.jpg'},
    'Sangre de Cristo':{src:'assets/ranges/sangre-de-cristo.jpg',credit:'Jeffrey Beall · CC BY-SA 2.0',source:'https://commons.wikimedia.org/wiki/File:Sangre_de_Cristo_Mountains,_Colorado.jpg'},
    'Elk':{src:'assets/ranges/elk.jpg',credit:'Ken Lund · CC BY-SA 2.0',source:'https://commons.wikimedia.org/wiki/File:Elk_Mountains,_Colorado_(9181504734).jpg'},
    'Front':{src:'assets/ranges/front.jpg',credit:'James St. John · CC BY 2.0',source:'https://commons.wikimedia.org/wiki/File:Front_Range_(north_of_Boulder,_Colorado,_USA).jpg'},
    'Tenmile-Mosquito':{src:'assets/ranges/tenmile-mosquito.jpg',credit:'DReifGalaxyM31 · CC0',source:'https://commons.wikimedia.org/wiki/File:Ten_Mile_Range_from_Copper_Mountain.JPG'}
  };
  var embed=/[?&]embed=1/.test(location.search);
  // The terrain tracker is the finished experience. Keep the legacy poster
  // available only when explicitly requested for comparison.
  var widgetLab=!/[?&]widget=poster(?:[&#]|$)/.test(location.search);
  var leafletMap,markers={},markerStyles={},activeSlug,labPeaks,labSummits,terrainScene;
  var terrainTreatment='alpine';
  var terrainCamera={yaw:.218,pitch:.52};

  if(embed) document.body.className+=' embed';
  if(widgetLab){
    document.body.className+=' ribbon-lab';
    var introCopy=document.querySelector('.intro>p:last-child');
    if(introCopy) introCopy.textContent='A statewide terrain profile, with every fourteeners challenge marked along the range.';
  }

  function esc(value){var el=document.createElement('div');el.textContent=value==null?'':String(value);return el.innerHTML;}
  function n(value){return Number(value||0).toLocaleString('en-US');}
  function decodeElevationTiff(buffer){
    var view=new DataView(buffer),little=view.getUint16(0,false)===0x4949,offset=view.getUint32(4,little),count=view.getUint16(offset,little),sizes={3:2,4:4},tags={};
    for(var i=0;i<count;i++){var entry=offset+2+i*12,tag=view.getUint16(entry,little),type=view.getUint16(entry+2,little),length=view.getUint32(entry+4,little),size=sizes[type]||1,start=length*size<=4?entry+8:view.getUint32(entry+8,little),values=[];for(var j=0;j<length;j++){values.push(type===3?view.getUint16(start+j*size,little):view.getUint32(start+j*size,little));}tags[tag]=values;}
    var width=tags[256]&&tags[256][0],height=tags[257]&&tags[257][0],tileWidth=tags[322]&&tags[322][0],tileHeight=tags[323]&&tags[323][0],offsets=tags[324];
    if(!width||!height||!tileWidth||!tileHeight||!offsets) throw new Error('Unsupported elevation grid');
    var values=new Float32Array(width*height),tilesAcross=Math.ceil(width/tileWidth);
    for(var y=0;y<height;y++){for(var x=0;x<width;x++){var tileX=Math.floor(x/tileWidth),tileY=Math.floor(y/tileHeight),tile=tileY*tilesAcross+tileX,cell=(y%tileHeight)*tileWidth+(x%tileWidth);values[y*width+x]=view.getFloat32(offsets[tile]+cell*4,little);}}
    return {columns:width,rows:height,values:values};
  }
  function date(value){var d=/^\d{4}-\d{2}-\d{2}$/.test(value||'')?new Date(value+'T12:00:00'):null;return d?d.toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'}):esc(value||'date unknown');}
  function shortName(name){return name.replace(/^Mount /,'Mt. ').replace('Mount of the ','Holy ').replace('Mountain','Mtn.');}
  function posterName(name){return shortName(name).replace('Peak','').replace('Point','Pt.').trim();}
  function hasClass(el,name){return el.classList.contains(name);}
  function addClass(el,name){el.classList.add(name);}
  function removeClass(el,name){el.classList.remove(name);}
  function fail(){poster.innerHTML='<p class="loading">The tracker data could not load. Try reloading.</p>';if(list)list.innerHTML='';if(locationMap)locationMap.innerHTML='<p class="loading">The map data could not load. Try reloading.</p>';}

  function setRowOpen(row,open){
    if(!row) return;
    var detail=row.querySelector('.peak-detail');
    var button=row.querySelector('.peak-toggle');
    if(open) addClass(row,'open'); else removeClass(row,'open');
    detail.hidden=!open;
    button.setAttribute('aria-expanded',String(open));
  }

  function setRangeOpen(range,open){
    if(!range) return;
    var content=range.querySelector('.range-peaks');
    var button=range.querySelector('.range-toggle');
    if(open) addClass(range,'open'); else removeClass(range,'open');
    content.hidden=!open;
    button.setAttribute('aria-expanded',String(open));
  }

  function updateSelection(slug){
    var items=document.querySelectorAll('[data-slug]');
    Array.prototype.forEach.call(items,function(item){
      if(item.dataset.slug===slug) addClass(item,'is-selected'); else removeClass(item,'is-selected');
    });
    Object.keys(markers).forEach(function(key){
      var style=markerStyles[key];
      markers[key].setStyle(key===slug?{radius:10,weight:3,color:'#f8f3e8'}:style);
    });
    if(terrainScene) terrainScene.setSelected(slug);
  }

  function activatePeak(slug,scroll,openPopup){
    activeSlug=slug;
    var row=document.getElementById('peak-'+slug);
    var range=row&&row.closest?row.closest('.range'):null;
    setRangeOpen(range,true);
    setRowOpen(row,true);
    updateSelection(slug);
    if(widgetLab&&labPeaks) renderRibbonLab(labPeaks,labSummits);
    if(scroll&&row) row.scrollIntoView({behavior:'smooth',block:'center'});
    if(leafletMap&&markers[slug]){
      if(openPopup) markers[slug].openPopup();
      leafletMap.panTo(markers[slug].getLatLng(),{animate:true,duration:.45});
    }
  }

  function mountainShape(x,y,w,h,variant){
    var b=y+h,c=x+w/2;
    if(variant===0)return {
      base:'M '+x+' '+b+' L '+(x+w*.1)+' '+(y+h*.73)+' L '+(c-w*.18)+' '+(y+h*.43)+' L '+c+' '+y+' L '+(c+w*.17)+' '+(y+h*.47)+' L '+(x+w*.87)+' '+(y+h*.7)+' L '+(x+w)+' '+b+' Z',
      ridge:'M '+(x+w*.1)+' '+(y+h*.73)+' L '+(c-w*.02)+' '+(y+h*.18)+' L '+(c+w*.17)+' '+(y+h*.47),
      snow:'M '+c+' '+y+' L '+(c-w*.1)+' '+(y+h*.27)+' L '+(c+w*.1)+' '+(y+h*.28)+' Z'
    };
    if(variant===1)return {
      base:'M '+x+' '+b+' L '+(x+w*.08)+' '+(y+h*.78)+' L '+(c-w*.22)+' '+(y+h*.5)+' L '+(c-w*.08)+' '+(y+h*.34)+' L '+(c+w*.05)+' '+y+' L '+(c+w*.2)+' '+(y+h*.53)+' L '+(x+w*.9)+' '+(y+h*.72)+' L '+(x+w)+' '+b+' Z',
      ridge:'M '+(x+w*.08)+' '+(y+h*.78)+' L '+(c-w*.04)+' '+(y+h*.17)+' L '+(c+w*.2)+' '+(y+h*.53),
      snow:'M '+(c+w*.05)+' '+y+' L '+(c-w*.02)+' '+(y+h*.2)+' L '+(c+w*.12)+' '+(y+h*.3)+' Z'
    };
    if(variant===2)return {
      base:'M '+x+' '+b+' L '+(x+w*.16)+' '+(y+h*.67)+' L '+(c-w*.2)+' '+(y+h*.46)+' L '+(c-w*.07)+' '+(y+h*.28)+' L '+(c+w*.04)+' '+y+' L '+(c+w*.15)+' '+(y+h*.35)+' L '+(c+w*.27)+' '+(y+h*.55)+' L '+(x+w*.9)+' '+(y+h*.75)+' L '+(x+w)+' '+b+' Z',
      ridge:'M '+(x+w*.16)+' '+(y+h*.67)+' L '+(c-w*.01)+' '+(y+h*.12)+' L '+(c+w*.27)+' '+(y+h*.55),
      snow:'M '+(c+w*.04)+' '+y+' L '+(c-w*.045)+' '+(y+h*.24)+' L '+(c+w*.12)+' '+(y+h*.29)+' Z'
    };
    return {
      base:'M '+x+' '+b+' L '+(x+w*.1)+' '+(y+h*.74)+' L '+(c-w*.16)+' '+(y+h*.5)+' L '+(c-w*.04)+' '+(y+h*.18)+' L '+(c+w*.08)+' '+y+' L '+(c+w*.2)+' '+(y+h*.45)+' L '+(x+w*.9)+' '+(y+h*.72)+' L '+(x+w)+' '+b+' Z',
      ridge:'M '+(x+w*.1)+' '+(y+h*.74)+' L '+(c+w*.04)+' '+(y+h*.14)+' L '+(c+w*.2)+' '+(y+h*.45),
      snow:'M '+(c+w*.08)+' '+y+' L '+(c-w*.02)+' '+(y+h*.2)+' L '+(c+w*.15)+' '+(y+h*.3)+' Z'
    };
  }

  function posterMarkup(peaks,summits){
    var mountains='',labels='',rowColumns={},placed=[];
    var posterLayout=[
      [{cx:350,y:26,w:224,h:124,z:10}],
      [{cx:278,y:105,w:185,h:93,z:21},{cx:421,y:112,w:178,h:89,z:20}],
      [{cx:199,y:158,w:160,h:81,z:30},{cx:350,y:169,w:178,h:89,z:32},{cx:502,y:157,w:160,h:81,z:31}],
      [{cx:172,y:211,w:160,h:88,z:41},{cx:350,y:219,w:158,h:85,z:40},{cx:528,y:214,w:160,h:87,z:42}],
      [{cx:104,y:273,w:140,h:78,z:51},{cx:250,y:264,w:144,h:79,z:50},{cx:430,y:280,w:140,h:77,z:53},{cx:592,y:270,w:140,h:78,z:52}],
      [{cx:120,y:332,w:136,h:75,z:61},{cx:284,y:322,w:140,h:77,z:60},{cx:464,y:338,w:136,h:75,z:63},{cx:590,y:326,w:134,h:74,z:62}],
      [{cx:92,y:389,w:120,h:68,z:70},{cx:225,y:381,w:124,h:69,z:72},{cx:355,y:397,w:124,h:69,z:71},{cx:485,y:383,w:124,h:69,z:73},{cx:610,y:391,w:120,h:68,z:74}],
      [{cx:105,y:449,w:120,h:67,z:81},{cx:235,y:458,w:122,h:68,z:80},{cx:370,y:443,w:124,h:69,z:83},{cx:505,y:456,w:122,h:68,z:82},{cx:600,y:448,w:118,h:66,z:84}],
      [{cx:89,y:508,w:118,h:66,z:90},{cx:215,y:499,w:122,h:67,z:92},{cx:350,y:514,w:122,h:67,z:91},{cx:485,y:501,w:122,h:67,z:93},{cx:612,y:510,w:116,h:65,z:94}],
      [{cx:77,y:568,w:106,h:60,z:101},{cx:190,y:560,w:110,h:61,z:100},{cx:310,y:574,w:110,h:61,z:103},{cx:430,y:561,w:110,h:61,z:102},{cx:550,y:573,w:110,h:61,z:105},{cx:628,y:563,w:104,h:59,z:104}],
      [{cx:77,y:623,w:106,h:60,z:110},{cx:190,y:633,w:110,h:61,z:112},{cx:310,y:618,w:110,h:61,z:111},{cx:430,y:632,w:110,h:61,z:113},{cx:550,y:621,w:110,h:61,z:114},{cx:628,y:630,w:104,h:59,z:115}],
      [{cx:87,y:679,w:108,h:61,z:121},{cx:198,y:669,w:110,h:61,z:120},{cx:318,y:685,w:110,h:61,z:123},{cx:438,y:672,w:110,h:61,z:122},{cx:558,y:684,w:110,h:61,z:125},{cx:625,y:674,w:102,h:58,z:124}],
      [{cx:145,y:735,w:128,h:70,z:130},{cx:290,y:726,w:132,h:72,z:132},{cx:435,y:740,w:130,h:71,z:131},{cx:560,y:729,w:126,h:69,z:133}],
      [{cx:160,y:793,w:120,h:66,z:141},{cx:300,y:803,w:124,h:68,z:140},{cx:435,y:790,w:124,h:68,z:143},{cx:558,y:800,w:118,h:65,z:142}]
    ];
    peaks.forEach(function(p,index){
      var row=Math.round((p.xy[1]-20)/58),column=rowColumns[p.xy[1]]||0,guide=(posterLayout[row]||[])[column];
      rowColumns[p.xy[1]]=column+1;
      var w=guide?guide.w:p.w,x=guide?guide.cx-w/2:p.xy[0],y=guide?guide.y:26+p.xy[1],h=guide?guide.h:Math.max(66,Math.round(w*.55));
      var c=x+w/2,on=!!summits[p.slug],shape=mountainShape(x,y,w,h,index%4),r=ranges.indexOf(p.range);
      var grain='M '+(x+w*.18).toFixed(1)+' '+(y+h*.79).toFixed(1)+' L '+(c-w*.02).toFixed(1)+' '+(y+h*.53).toFixed(1)+' M '+(c+w*.03).toFixed(1)+' '+(y+h*.57).toFixed(1)+' L '+(x+w*.82).toFixed(1)+' '+(y+h*.77).toFixed(1);
      placed.push({c:c,grain:grain,h:h,index:index,on:on,p:p,r:r,shape:shape,w:w,x:x,y:y,z:guide?guide.z:index});
    });
    placed.sort(function(a,b){return a.z-b.z;}).forEach(function(item){
      mountains+='<g class="poster-peak '+(item.on?'done ':'')+'r'+item.r+'" data-slug="'+esc(item.p.slug)+'" tabindex="0" role="button" aria-label="Open '+esc(item.p.name)+' details"><title>'+esc(item.p.name)+' · '+n(item.p.elev)+' ft'+(item.on?' · summited':'')+'</title><path class="mountain-base" d="'+item.shape.base+'"/><path class="mountain-snow" d="'+item.shape.snow+'"/><path class="mountain-grain" d="'+item.grain+'"/></g>';
    });
    placed.forEach(function(item){
      labels+='<text class="peak-label '+(item.on?'done ':'')+(posterName(item.p.name).length>13?'compact':'')+'" x="'+item.c+'" y="'+(item.y+item.h*.62).toFixed(1)+'"><tspan class="elev" x="'+item.c+'">'+n(item.p.elev)+'′</tspan><tspan x="'+item.c+'" dy="11">'+esc(posterName(item.p.name))+'</tspan></text>';
    });
    return '<svg class="poster" viewBox="0 0 700 1000" role="img" aria-label="Colorado fourteeners poster — '+Object.keys(summits).length+' of 58 summited"><defs><linearGradient id="posterField" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#1c5f70"/><stop offset=".48" stop-color="#104958"/><stop offset="1" stop-color="#073442"/></linearGradient><pattern id="posterGrain" width="17" height="17" patternUnits="userSpaceOnUse"><circle fill="#f3e0bd" cx="2" cy="3" r=".7"/><circle fill="#f3e0bd" cx="13" cy="5" r=".45"/><circle fill="#f3e0bd" cx="8" cy="14" r=".55"/></pattern></defs><rect class="poster-bg" x="0" y="0" width="700" height="1000" rx="6"/><circle class="poster-sun" cx="350" cy="58" r="52"/><rect class="poster-grain" x="0" y="0" width="700" height="1000" rx="6"/>'+mountains+labels+'<g class="poster-footer"><text x="350" y="947">FIFTY-EIGHT SUMMITS</text><text x="350" y="970">COLORADO · 14ER TRACKER</text></g></svg>';
  }

  function renderAlpineMap(peaks,summits){
    var done=peaks.filter(function(p){return !!summits[p.slug];}),remaining=peaks.length-done.length,progress=Math.round((done.length/peaks.length)*100);
    var highest=done.length?done.slice().sort(function(a,b){return b.elev-a.elev;})[0]:null,next=peaks.slice().sort(function(a,b){return b.elev-a.elev;}).filter(function(p){return !summits[p.slug];})[0]||null;
    var rangesStarted=ranges.filter(function(range){return peaks.some(function(p){return p.range===range&&!!summits[p.slug];});}).length;
    var lats=peaks.map(function(p){return p.latlon[0];}),lons=peaks.map(function(p){return p.latlon[1];}),minLat=Math.min.apply(null,lats)-.12,maxLat=Math.max.apply(null,lats)+.12,minLon=Math.min.apply(null,lons)-.12,maxLon=Math.max.apply(null,lons)+.12;
    var left=48,right=772,top=36,bottom=268,lonSpan=maxLon-minLon,latSpan=maxLat-minLat,zoneMarkup='',markersMarkup='',labelsMarkup='',placed=[];
    function project(point){return {x:left+((point.latlon[1]-minLon)/lonSpan)*(right-left),y:top+((maxLat-point.latlon[0])/latSpan)*(bottom-top)};}
    function rangeLabel(name){return name==='Tenmile-Mosquito'?'TENMILE / MOSQUITO':name.toUpperCase();}
    ranges.forEach(function(rangeName,rangeIndex){
      var group=peaks.filter(function(p){return p.range===rangeName;}),coords=group.map(project),xs=coords.map(function(point){return point.x;}),ys=coords.map(function(point){return point.y;}),cx=xs.reduce(function(a,b){return a+b;},0)/xs.length,cy=ys.reduce(function(a,b){return a+b;},0)/ys.length,rx=Math.max(44,(Math.max.apply(null,xs)-Math.min.apply(null,xs))/2+30),ry=Math.max(29,(Math.max.apply(null,ys)-Math.min.apply(null,ys))/2+25),complete=group.filter(function(p){return !!summits[p.slug];}).length;
      var ridge='M '+(cx-rx*.92).toFixed(1)+' '+(cy+ry*.27).toFixed(1)+' L '+(cx-rx*.48).toFixed(1)+' '+(cy-ry*.38).toFixed(1)+' L '+cx.toFixed(1)+' '+(cy-ry*.08).toFixed(1)+' L '+(cx+rx*.5).toFixed(1)+' '+(cy-ry*.44).toFixed(1)+' L '+(cx+rx*.92).toFixed(1)+' '+(cy+ry*.25).toFixed(1);
      zoneMarkup+='<g class="alpine-map-range zone-'+rangeIndex+'"><ellipse cx="'+cx.toFixed(1)+'" cy="'+cy.toFixed(1)+'" rx="'+rx.toFixed(1)+'" ry="'+ry.toFixed(1)+'"/><path class="alpine-map-ridge" d="'+ridge+'"/><text x="'+cx.toFixed(1)+'" y="'+(cy-ry-7).toFixed(1)+'">'+esc(rangeLabel(rangeName))+'<tspan x="'+cx.toFixed(1)+'" dy="10">'+complete+' / '+group.length+' SUMMITED</tspan></text></g>';
    });
    peaks.forEach(function(p,index){
      var point=project(p),offsets=[[0,0]],candidate,offset;
      for(var ring=1;ring<=10;ring++){for(var step=0;step<12;step++){var angle=(Math.PI*2*step/12)+(ring%2?0:Math.PI/12);offsets.push([Math.cos(angle)*ring*11,Math.sin(angle)*ring*11]);}}
      for(var i=0;i<offsets.length;i++){candidate={x:point.x+offsets[i][0],y:point.y+offsets[i][1]};if(candidate.x>42&&candidate.x<778&&candidate.y>30&&candidate.y<278&&placed.every(function(other){var dx=other.x-candidate.x,dy=other.y-candidate.y;return dx*dx+dy*dy>750;})){offset=offsets[i];break;}}
      offset=offset||offsets[offsets.length-1];candidate={x:point.x+offset[0],y:point.y+offset[1],p:p};placed.push(candidate);
      var completed=!!summits[p.slug],selected=p.slug===activeSlug;
      markersMarkup+='<g class="ribbon-peak alpine-map-peak '+(completed?'done ':'')+(selected?'is-selected ':'')+'" data-slug="'+esc(p.slug)+'" data-range="'+esc(p.range)+'" tabindex="0" role="button" aria-label="Open '+esc(p.name)+' details"><title>'+esc(p.name)+' · '+n(p.elev)+' ft · '+esc(p.range)+(completed?' · summited':'')+'</title>'+(offset[0]||offset[1]?'<line class="alpine-map-leader" x1="'+point.x.toFixed(1)+'" y1="'+point.y.toFixed(1)+'" x2="'+candidate.x.toFixed(1)+'" y2="'+candidate.y.toFixed(1)+'"/>':'')+'<circle class="ribbon-hit" cx="'+candidate.x.toFixed(1)+'" cy="'+candidate.y.toFixed(1)+'" r="13"/><circle class="ribbon-marker" cx="'+candidate.x.toFixed(1)+'" cy="'+candidate.y.toFixed(1)+'" r="'+(selected?7:5)+'"/></g>';
      if(selected||completed){labelsMarkup+='<text class="alpine-map-peak-label '+(completed?'done ':'')+'" x="'+candidate.x.toFixed(1)+'" y="'+(candidate.y-10).toFixed(1)+'" text-anchor="middle">'+esc(posterName(p.name))+'<tspan x="'+candidate.x.toFixed(1)+'" dy="9">'+n(p.elev)+'′</tspan></text>';}
    });
    poster.className='poster-pane ribbon-lab-pane treatment-topo';
    poster.innerHTML='<div class="ribbon-lab-heading"><div><p class="ribbon-kicker">Your progress</p><h2>Every summit, in view.</h2></div><p>Colorado fourteeners · Topo range map</p></div><div class="ribbon-progress-strip"><div><span>Summited</span><strong>'+done.length+'</strong></div><div><span>Remaining</span><strong>'+remaining+'</strong></div><div class="ribbon-progress-meter"><span><i style="width:'+progress+'%"></i></span><em>'+progress+'% complete</em></div></div><div class="ribbon-insights"><div><span>Highest reached</span><strong>'+(highest?esc(shortName(highest.name)):'First summit ahead')+'</strong><em>'+(highest?n(highest.elev)+' ft':'The trail starts here.')+'</em></div><div><span>Highest remaining</span><strong>'+(next?esc(shortName(next.name)):'All clear')+'</strong><em>'+(next?n(next.elev)+' ft':'Every summit logged.')+'</em></div><div><span>Ranges started</span><strong>'+rangesStarted+' <i>/ 6</i></strong><em>One summit opens a range.</em></div></div><div class="terrain-switcher" role="group" aria-label="Terrain treatment"><span>Terrain</span><button type="button" data-terrain="topo" aria-pressed="true">Topo</button><button type="button" data-terrain="alpine" aria-pressed="false">Alpine</button><button type="button" data-terrain="ranges" aria-pressed="false">Ranges</button></div><div class="ribbon-key"><span class="key done"></span>summited <span class="key"></span>still to climb</div><div class="ribbon-scroll"><svg class="alpine-map" viewBox="0 0 820 340" role="img" aria-label="Geographic Colorado fourteeners range map showing '+done.length+' summited and '+remaining+' remaining"><rect class="alpine-map-field" x="32" y="20" width="756" height="270" rx="10"/><path class="alpine-map-contour" d="M 55 82 Q 187 38 305 91 T 575 73 T 766 94 M 49 173 Q 153 127 266 173 T 507 151 T 776 169 M 56 245 Q 181 203 305 246 T 564 225 T 766 237"/>'+zoneMarkup+markersMarkup+labelsMarkup+'<text class="alpine-map-compass" x="66" y="49">N</text><path class="alpine-map-north" d="M 66 55 L 66 69 M 61 60 L 66 55 L 71 60"/></svg></div><p class="ribbon-help">Each dot is a real summit position. Select one to open its climb record and map location.</p>';
    Array.prototype.slice.call(poster.querySelectorAll('[data-terrain]')).forEach(function(button){button.addEventListener('click',function(){terrainTreatment=button.dataset.terrain;renderRibbonLab(peaks,summits);});});
    Array.prototype.slice.call(poster.querySelectorAll('.ribbon-peak')).forEach(function(peak){peak.addEventListener('click',function(){activatePeak(peak.dataset.slug,true,true);});peak.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();activatePeak(peak.dataset.slug,true,true);}});});
  }

  function renderAlpinePerspective(peaks,summits){
    var done=peaks.filter(function(p){return !!summits[p.slug];}),remaining=peaks.length-done.length,progress=Math.round((done.length/peaks.length)*100),highest=done.length?done.slice().sort(function(a,b){return b.elev-a.elev;})[0]:null,next=peaks.slice().sort(function(a,b){return b.elev-a.elev;}).filter(function(p){return !summits[p.slug];})[0]||null,rangesStarted=ranges.filter(function(range){return peaks.some(function(p){return p.range===range&&!!summits[p.slug];});}).length;
    var west=-109.05,east=-102.04,south=36.99,north=41,sceneWest=west-(east-west)*.5,sceneEast=east+(east-west)*.5,sceneSouth=south-(north-south)*.5,sceneNorth=north+(north-south)*.5,baseCenterX=421.5,baseCenterY=220,terrainSpan=830,terrainFloor=14000,terrainCeiling=14450,terrainHeight=42,terrainSurfaceHeight=130;
    function sampleDem(sampleLon,sampleLat){var x=Math.max(0,Math.min(demTerrain.columns-1,(sampleLon-west)/(east-west)*(demTerrain.columns-1))),y=Math.max(0,Math.min(demTerrain.rows-1,(north-sampleLat)/(north-south)*(demTerrain.rows-1))),x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(demTerrain.columns-1,x0+1),y1=Math.min(demTerrain.rows-1,y0+1),mixX=x-x0,mixY=y-y0,a=demTerrain.values[y0*demTerrain.columns+x0],b=demTerrain.values[y0*demTerrain.columns+x1],c=demTerrain.values[y1*demTerrain.columns+x0],d=demTerrain.values[y1*demTerrain.columns+x1];return (a+(b-a)*mixX+(c+(d-c)*mixX-a-(b-a)*mixX)*mixY)*3.28084;}
    function terrainElevation(lon,lat){
      if(demTerrain)return sampleDem(lon,lat);
      var elevation=5200;peaks.forEach(function(peak){var dx=(lon-peak.latlon[1])*54,dy=(lat-peak.latlon[0])*69,distance=Math.sqrt(dx*dx+dy*dy);elevation=Math.max(elevation,peak.elev-distance*160);});return Math.max(5200,elevation);
    }
    function projectElevation(lon,lat,elevation){var lonFraction=(lon-west)/(east-west),latFraction=(lat-south)/(north-south),x=lonFraction-.5,y=latFraction-.5,cosYaw=Math.cos(terrainCamera.yaw),sinYaw=Math.sin(terrainCamera.yaw),orbitX=x*cosYaw-y*sinYaw,orbitY=x*sinYaw+y*cosYaw,groundX=baseCenterX+orbitX*terrainSpan,groundY=baseCenterY+orbitY*terrainSpan*.34;return {groundX:groundX,groundY:groundY,x:groundX,y:groundY-((elevation-terrainFloor)/(terrainCeiling-terrainFloor))*terrainHeight};}
    function projectSurface(lon,lat,elevation){var base=projectElevation(lon,lat,terrainFloor),relief=Math.max(0,Math.min(1,(elevation-5200)/9300));return {groundX:base.groundX,groundY:base.groundY,x:base.x,y:base.groundY-relief*terrainSurfaceHeight};}
    function project(p){var surface=meshSurfaceElevation(p.latlon[1],p.latlon[0]),surfaceProjection=projectSurface(p.latlon[1],p.latlon[0],surface);return {p:p,groundX:surfaceProjection.groundX,groundY:surfaceProjection.groundY,surfaceY:surfaceProjection.y,x:surfaceProjection.x,y:surfaceProjection.y};}
    var sw=projectElevation(west,south,terrainFloor),se=projectElevation(east,south,terrainFloor),nw=projectElevation(west,north,terrainFloor),ne=projectElevation(east,north,terrainFloor),points,longitudeLines=[-109,-108,-107,-106,-105,-104,-103].map(function(lon){var back=projectElevation(lon,north,terrainFloor),front=projectElevation(lon,south,terrainFloor),label=(lon===-109||lon===-106||lon===-103)?'<text x="'+(front.x+2).toFixed(1)+'" y="'+(front.y+12).toFixed(1)+'">'+Math.abs(lon)+'°W</text>':'';return '<path d="M '+back.x.toFixed(1)+' '+back.y.toFixed(1)+' L '+front.x.toFixed(1)+' '+front.y.toFixed(1)+'"/>'+label;}).join(''),latitudeLines=[37,38,39,40,41].map(function(lat){var left=projectElevation(west,lat,terrainFloor),right=projectElevation(east,lat,terrainFloor),label=(lat===37||lat===39||lat===41)?'<text x="'+(left.x-6).toFixed(1)+'" y="'+(left.y+3).toFixed(1)+'" text-anchor="end">'+lat+'°N</text>':'';return '<path d="M '+left.x.toFixed(1)+' '+left.y.toFixed(1)+' L '+right.x.toFixed(1)+' '+right.y.toFixed(1)+'"/>'+label;}).join('');
    var elevationAxis=[6000,10000,14000].map(function(elev){var point=projectElevation(west,south,elev);return '<path d="M '+(point.x-7).toFixed(1)+' '+point.y.toFixed(1)+' H '+(point.x+6).toFixed(1)+'"/><text x="'+(point.x-12).toFixed(1)+'" y="'+(point.y+3).toFixed(1)+'" text-anchor="end">'+Math.round(elev/1000)+'K</text>';}).join('');
    var rangeLabels='';
    var meshCells=[],meshColumns=84,meshRows=50,terrainGrid=[];
    function terrainTexture(lon,lat){return {x:4000*Math.max(.001,Math.min(.999,(lon-west)/(east-west))),y:2280*Math.max(.001,Math.min(.999,(north-lat)/(north-south)))}}
    for(var gridRow=0;gridRow<=meshRows;gridRow++){terrainGrid[gridRow]=[];for(var gridColumn=0;gridColumn<=meshColumns;gridColumn++){var gridLon=sceneWest+(sceneEast-sceneWest)*(gridColumn/meshColumns),gridLat=sceneSouth+(sceneNorth-sceneSouth)*(gridRow/meshRows);terrainGrid[gridRow][gridColumn]=terrainElevation(gridLon,gridLat);}}
    // Use the identical A-B-C / A-C-D triangle split as the canvas renderer.
    // This keeps every summit dot physically attached to its terrain face.
    function meshSurfaceElevation(lon,lat){var u=Math.max(0,Math.min(meshColumns,(lon-sceneWest)/(sceneEast-sceneWest)*meshColumns)),v=Math.max(0,Math.min(meshRows,(lat-sceneSouth)/(sceneNorth-sceneSouth)*meshRows)),column=Math.min(meshColumns-1,Math.floor(u)),row=Math.min(meshRows-1,Math.floor(v)),mixX=u-column,mixY=v-row,a=terrainGrid[row][column],b=terrainGrid[row][column+1],c=terrainGrid[row+1][column+1],d=terrainGrid[row+1][column];return mixY<=mixX?(1-mixX)*a+(mixX-mixY)*b+mixY*c:(1-mixY)*a+mixX*c+(mixY-mixX)*d;}
    for(var row=0;row<meshRows;row++){for(var column=0;column<meshColumns;column++){var lonA=sceneWest+(sceneEast-sceneWest)*(column/meshColumns),lonB=sceneWest+(sceneEast-sceneWest)*((column+1)/meshColumns),latA=sceneSouth+(sceneNorth-sceneSouth)*(row/meshRows),latB=sceneSouth+(sceneNorth-sceneSouth)*((row+1)/meshRows),elevationA=terrainGrid[row][column],elevationB=terrainGrid[row][column+1],elevationC=terrainGrid[row+1][column+1],elevationD=terrainGrid[row+1][column],a=projectSurface(lonA,latA,elevationA),b=projectSurface(lonB,latA,elevationB),c=projectSurface(lonB,latB,elevationC),d=projectSurface(lonA,latB,elevationD),textureA=terrainTexture(lonA,latA),textureB=terrainTexture(lonB,latA),textureC=terrainTexture(lonB,latB),textureD=terrainTexture(lonA,latB);meshCells.push({depth:(a.groundY+b.groundY+c.groundY+d.groundY)/4,lonA:lonA,lonB:lonB,latA:latA,latB:latB,elevation:[elevationA,elevationB,elevationC,elevationD],texture:[textureA,textureB,textureC,textureD]});}}
    points=peaks.map(project);
    function matrixFromPlane(width,height,origin,eastPoint,northPoint){return 'matrix('+((eastPoint.x-origin.x)/width).toFixed(4)+' '+((eastPoint.y-origin.y)/width).toFixed(4)+' '+((northPoint.x-origin.x)/height).toFixed(4)+' '+((northPoint.y-origin.y)/height).toFixed(4)+' '+origin.x.toFixed(1)+' '+origin.y.toFixed(1)+')';}
    var imageryMatrix=matrixFromPlane(4000,2280,sw,se,nw),reliefMatrix=matrixFromPlane(900,520,sw,se,nw),textureSouth={x:sw.x,y:sw.y-18},textureEast={x:se.x,y:se.y-18},textureNorth={x:nw.x,y:nw.y-104},surfaceImageryMatrix=matrixFromPlane(4000,2280,textureSouth,textureEast,textureNorth),surfaceReliefMatrix=matrixFromPlane(900,520,textureSouth,textureEast,textureNorth),planePath='M '+sw.x.toFixed(1)+' '+sw.y.toFixed(1)+' L '+se.x.toFixed(1)+' '+se.y.toFixed(1)+' L '+ne.x.toFixed(1)+' '+ne.y.toFixed(1)+' L '+nw.x.toFixed(1)+' '+nw.y.toFixed(1)+' Z',shadowPath='M '+(sw.x+7).toFixed(1)+' '+(sw.y+8).toFixed(1)+' L '+(se.x+7).toFixed(1)+' '+(se.y+8).toFixed(1)+' L '+(ne.x+7).toFixed(1)+' '+(ne.y+8).toFixed(1)+' L '+(nw.x+7).toFixed(1)+' '+(nw.y+8).toFixed(1)+' Z',axisTop=projectElevation(west,south,terrainCeiling);
    meshCells.sort(function(a,b){return a.depth-b.depth;});
    var meshMarkup='';
    var markers=points.slice().sort(function(a,b){return a.groundY-b.groundY;}).map(function(point){var p=point.p,completed=!!summits[p.slug],selected=p.slug===activeSlug,rangeIndex=ranges.indexOf(p.range);return '<g class="alpine-3d-peak range-dot-'+rangeIndex+' '+(completed?'done ':'')+(selected?'is-selected ':'')+'" data-slug="'+esc(p.slug)+'" tabindex="0" role="button" aria-label="Open '+esc(p.name)+' details"><title>'+esc(p.name)+' · '+n(p.elev)+' ft · '+esc(p.range)+'</title><line class="alpine-3d-stem" x1="'+point.groundX.toFixed(1)+'" y1="'+point.surfaceY.toFixed(1)+'" x2="'+point.x.toFixed(1)+'" y2="'+point.y.toFixed(1)+'"/><circle class="ribbon-hit" cx="'+point.x.toFixed(1)+'" cy="'+point.y.toFixed(1)+'" r="12"/><circle class="ribbon-marker" cx="'+point.x.toFixed(1)+'" cy="'+point.y.toFixed(1)+'" r="'+(selected?6.5:4.4)+'"/></g>';}).join('');
    poster.className='poster-pane ribbon-lab-pane treatment-alpine perspective-pane';
    poster.innerHTML='<div class="ribbon-lab-heading"><div><p class="ribbon-kicker">Your progress</p><h2>Every summit, in space.</h2></div><p>Colorado fourteeners · geographic relief plot</p></div><div class="ribbon-progress-strip"><div><span>Summited</span><strong>'+done.length+'</strong></div><div><span>Remaining</span><strong>'+remaining+'</strong></div><div class="ribbon-progress-meter"><span><i style="width:'+progress+'%"></i></span><em>'+progress+'% complete</em></div></div><div class="ribbon-insights"><div><span>Highest reached</span><strong>'+(highest?esc(shortName(highest.name)):'First summit ahead')+'</strong><em>'+(highest?n(highest.elev)+' ft':'The trail starts here.')+'</em></div><div><span>Highest remaining</span><strong>'+(next?esc(shortName(next.name)):'All clear')+'</strong><em>'+(next?n(next.elev)+' ft':'Every summit logged.')+'</em></div><div><span>Ranges started</span><strong>'+rangesStarted+' <i>/ 6</i></strong><em>One summit opens a range.</em></div></div><div class="ribbon-key"><span class="key done"></span>summited <span class="key"></span>still to climb</div><div class="ribbon-scroll alpine-perspective-scroll"><svg class="alpine-perspective" viewBox="0 0 820 340" role="img" aria-label="Rotatable three-dimensional Colorado fourteeners surface plot by longitude, latitude, and elevation"><defs><pattern id="alpine-surface-topography" patternUnits="userSpaceOnUse" width="820" height="340"><image href="assets/usgs-colorado-statewide-ultra.jpg" width="4000" height="2280" transform="'+surfaceImageryMatrix+'" preserveAspectRatio="none"/><image class="alpine-3d-relief" href="assets/usgs-colorado-relief.png" width="900" height="520" transform="'+surfaceReliefMatrix+'" preserveAspectRatio="none"/></pattern></defs><rect class="alpine-3d-field" x="42" y="58" width="736" height="232" rx="10"/><path class="alpine-3d-plane-shadow" d="'+shadowPath+'"/><image class="alpine-3d-imagery" href="assets/usgs-colorado-statewide-ultra.jpg" width="4000" height="2280" transform="'+imageryMatrix+'" preserveAspectRatio="none"/><image class="alpine-3d-relief" href="assets/usgs-colorado-relief.png" width="900" height="520" transform="'+reliefMatrix+'" preserveAspectRatio="none"/>'+meshMarkup+'<path class="alpine-3d-plane-outline" d="'+planePath+'"/><g class="alpine-3d-grid">'+longitudeLines+latitudeLines+'</g><g class="alpine-3d-elevation-axis"><path d="M '+sw.x.toFixed(1)+' '+sw.y.toFixed(1)+' L '+axisTop.x.toFixed(1)+' '+axisTop.y.toFixed(1)+'"/>'+elevationAxis+'<text class="alpine-3d-axis-title" x="'+(sw.x-28).toFixed(1)+'" y="'+((sw.y+axisTop.y)/2).toFixed(1)+'" transform="rotate(-90 '+(sw.x-28).toFixed(1)+' '+((sw.y+axisTop.y)/2).toFixed(1)+')">ELEVATION · FT</text></g>'+rangeLabels+markers+'</svg><div class="alpine-inspector" aria-live="polite" hidden></div></div><div class="terrain-rotate-note"><span>Drag the terrain to rotate the view.</span><button class="terrain-reset" type="button">Reset view</button></div><p class="ribbon-help">Cached USGS 3DEP terrain: each marker is projected onto the same rendered terrain surface at its summit coordinate.</p>';
    var terrainScroll=poster.querySelector('.alpine-perspective-scroll'),terrainCanvas=document.createElement('canvas');
    var renderScale=Math.min(2,window.devicePixelRatio||1);terrainCanvas.className='alpine-terrain-canvas';terrainCanvas.width=820*renderScale;terrainCanvas.height=340*renderScale;terrainCanvas.setAttribute('aria-hidden','true');terrainScroll.insertBefore(terrainCanvas,terrainScroll.firstChild);var terrainStage=document.createElement('div'),terrainGraphic=terrainScroll.querySelector('.alpine-perspective');terrainStage.className='terrain-stage';terrainScroll.insertBefore(terrainStage,terrainCanvas);terrainStage.appendChild(terrainCanvas);terrainStage.appendChild(terrainGraphic);poster.querySelector('.alpine-3d-field').style.fill='transparent';
    function paintTriangle(context,image,source,destination,alpha,scaleX,scaleY,outputScale){var s0={x:source[0].x*scaleX,y:source[0].y*scaleY},s1={x:source[1].x*scaleX,y:source[1].y*scaleY},s2={x:source[2].x*scaleX,y:source[2].y*scaleY},d0=destination[0],d1=destination[1],d2=destination[2],denominator=s0.x*(s1.y-s2.y)+s1.x*(s2.y-s0.y)+s2.x*(s0.y-s1.y);if(Math.abs(denominator)<.001)return;var a=(d0.x*(s1.y-s2.y)+d1.x*(s2.y-s0.y)+d2.x*(s0.y-s1.y))/denominator,b=(d0.y*(s1.y-s2.y)+d1.y*(s2.y-s0.y)+d2.y*(s0.y-s1.y))/denominator,c=(d0.x*(s2.x-s1.x)+d1.x*(s0.x-s2.x)+d2.x*(s1.x-s0.x))/denominator,d=(d0.y*(s2.x-s1.x)+d1.y*(s0.x-s2.x)+d2.y*(s1.x-s0.x))/denominator,e=(d0.x*(s1.x*s2.y-s2.x*s1.y)+d1.x*(s2.x*s0.y-s0.x*s2.y)+d2.x*(s0.x*s1.y-s1.x*s0.y))/denominator,f=(d0.y*(s1.x*s2.y-s2.x*s1.y)+d1.y*(s2.x*s0.y-s0.x*s2.y)+d2.y*(s0.x*s1.y-s1.x*s0.y))/denominator;context.save();context.beginPath();context.moveTo(d0.x,d0.y);context.lineTo(d1.x,d1.y);context.lineTo(d2.x,d2.y);context.closePath();context.clip();context.globalAlpha=alpha;context.setTransform(a*outputScale,b*outputScale,c*outputScale,d*outputScale,e*outputScale,f*outputScale);context.drawImage(image,0,0);context.restore();}
    var drawDroneFrame,gridLayer=poster.querySelector('.alpine-3d-grid'),markerNodes={},markerLayer=terrainGraphic;Array.prototype.slice.call(poster.querySelectorAll('.alpine-3d-peak')).forEach(function(node){markerNodes[node.dataset.slug]=node;});
    function updateDroneOverlay(){
      gridLayer.innerHTML=[-109,-108,-107,-106,-105,-104,-103].map(function(lon){var back=projectElevation(lon,north,terrainFloor),front=projectElevation(lon,south,terrainFloor);return '<path d="M '+back.x.toFixed(1)+' '+back.y.toFixed(1)+' L '+front.x.toFixed(1)+' '+front.y.toFixed(1)+'"/>';}).join('')+[37,38,39,40,41].map(function(lat){var left=projectElevation(west,lat,terrainFloor),right=projectElevation(east,lat,terrainFloor);return '<path d="M '+left.x.toFixed(1)+' '+left.y.toFixed(1)+' L '+right.x.toFixed(1)+' '+right.y.toFixed(1)+'"/>';}).join('');
      var orderedMarkers=[];peaks.forEach(function(p){var point=project(p),node=markerNodes[p.slug],stem=node.querySelector('.alpine-3d-stem'),hit=node.querySelector('.ribbon-hit'),marker=node.querySelector('.ribbon-marker');stem.setAttribute('x1',point.groundX.toFixed(1));stem.setAttribute('y1',point.surfaceY.toFixed(1));stem.setAttribute('x2',point.x.toFixed(1));stem.setAttribute('y2',point.y.toFixed(1));hit.setAttribute('cx',point.x.toFixed(1));hit.setAttribute('cy',point.y.toFixed(1));marker.setAttribute('cx',point.x.toFixed(1));marker.setAttribute('cy',point.y.toFixed(1));orderedMarkers.push({node:node,depth:point.groundY});});orderedMarkers.sort(function(a,b){return a.depth-b.depth;}).forEach(function(item){markerLayer.appendChild(item.node);});
    }
    function paintTerrainCanvas(){
      var context=terrainCanvas.getContext('2d'),aerial=terrainAerialImage||(terrainAerialImage=new Image());
      function reprojectMesh(){meshCells.forEach(function(cell){cell.corners=[projectSurface(cell.lonA,cell.latA,cell.elevation[0]),projectSurface(cell.lonB,cell.latA,cell.elevation[1]),projectSurface(cell.lonB,cell.latB,cell.elevation[2]),projectSurface(cell.lonA,cell.latB,cell.elevation[3])];cell.depth=(cell.corners[0].groundY+cell.corners[1].groundY+cell.corners[2].groundY+cell.corners[3].groundY)/4;});meshCells.sort(function(a,b){return a.depth-b.depth;});}
      function paint(){drawDroneFrame=function(){context.setTransform(renderScale,0,0,renderScale,0,0);context.clearRect(0,0,820,340);context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';reprojectMesh();meshCells.forEach(function(cell){var corners=cell.corners,texture=cell.texture;paintTriangle(context,aerial,[texture[0],texture[1],texture[2]],[corners[0],corners[1],corners[2]],.96,1,1,renderScale);paintTriangle(context,aerial,[texture[0],texture[2],texture[3]],[corners[0],corners[2],corners[3]],.96,1,1,renderScale);});updateDroneOverlay();};drawDroneFrame();}
      if(!aerial.src)aerial.src='assets/usgs-colorado-statewide-ultra.jpg';if(aerial.complete)paint();else aerial.addEventListener('load',paint,{once:true});}
    paintTerrainCanvas();
    if(droneOrbitFrame)cancelAnimationFrame(droneOrbitFrame);var orbitStartedAt=0,lastOrbitDraw=0,orbitPaused=false,orbitAnchorYaw=terrainCamera.yaw;
    function advanceDroneOrbit(now){if(!orbitPaused){if(!orbitStartedAt)orbitStartedAt=now;if(now-lastOrbitDraw>160){terrainCamera.yaw=orbitAnchorYaw+((now-orbitStartedAt)/32000)*Math.PI*2;if(drawDroneFrame)drawDroneFrame();lastOrbitDraw=now;}}droneOrbitFrame=requestAnimationFrame(advanceDroneOrbit);}
    droneOrbitFrame=requestAnimationFrame(advanceDroneOrbit);
    var terrainNote=poster.querySelector('.terrain-rotate-note');terrainNote.innerHTML='<button class="terrain-pause" type="button" aria-pressed="false">Pause orbit</button><button class="terrain-reset" type="button">Reset view</button>';var pauseButton=terrainNote.querySelector('.terrain-pause'),resetButton=terrainNote.querySelector('.terrain-reset'),dragStartX=0,dragStartYaw=terrainCamera.yaw,dragging=false;
    function setOrbitPaused(paused){orbitPaused=paused;pauseButton.textContent=paused?'Resume orbit':'Pause orbit';pauseButton.setAttribute('aria-pressed',String(paused));if(!paused){orbitAnchorYaw=terrainCamera.yaw;orbitStartedAt=0;}}
    pauseButton.addEventListener('click',function(){setOrbitPaused(!orbitPaused);});
    resetButton.addEventListener('click',function(){terrainCamera.yaw=.218;orbitAnchorYaw=.218;orbitStartedAt=0;if(drawDroneFrame)drawDroneFrame();});
    terrainStage.addEventListener('pointerdown',function(event){if((event.button!==undefined&&event.button!==0)||(event.target.closest&&event.target.closest('.alpine-3d-peak')))return;dragging=true;dragStartX=event.clientX;dragStartYaw=terrainCamera.yaw;setOrbitPaused(true);terrainGraphic.classList.add('is-rotating');terrainStage.setPointerCapture(event.pointerId);});
    terrainStage.addEventListener('pointermove',function(event){if(!dragging)return;terrainCamera.yaw=dragStartYaw-(event.clientX-dragStartX)*.008;if(drawDroneFrame)drawDroneFrame();});
    function endTerrainDrag(event){if(!dragging)return;dragging=false;terrainGraphic.classList.remove('is-rotating');if(terrainStage.hasPointerCapture(event.pointerId))terrainStage.releasePointerCapture(event.pointerId);}
    terrainStage.addEventListener('pointerup',endTerrainDrag);terrainStage.addEventListener('pointercancel',endTerrainDrag);
    poster.querySelector('.ribbon-help').textContent='Cached USGS 3DEP terrain · every marker is projected onto the same rendered surface at its summit coordinate. Drag to explore; pause or resume the aerial orbit whenever you want.';
    var summary='<div class="range-photo-heading"><strong>Colorado mountain ranges</strong><span>real range views · summited / total</span></div><div class="range-photo-grid" aria-label="Colorado mountain range photographs">'+ranges.map(function(rangeName,index){var rangePeaks=peaks.filter(function(p){return p.range===rangeName;}),complete=rangePeaks.filter(function(p){return !!summits[p.slug];}).length,photo=rangePhotos[rangeName];return '<a class="range-photo range-color-'+index+'" href="'+photo.source+'" target="_blank" rel="noopener noreferrer" aria-label="View source and license for '+esc(rangeName)+' photograph"><img src="'+photo.src+'" alt="'+esc(rangeName)+' in Colorado" loading="lazy" decoding="async"><span class="range-photo-shade"></span><span class="range-photo-copy"><strong>'+esc(rangeName.replace('-', ' / '))+'</strong><em>'+complete+' / '+rangePeaks.length+' summited</em></span><span class="range-photo-credit">'+esc(photo.credit)+' ↗</span></a>';}).join('')+'</div>';
    poster.querySelector('.ribbon-help').insertAdjacentHTML('afterend',summary);
    var inspector=poster.querySelector('.alpine-inspector');
    function showPeak(peak){var p=peaks.filter(function(item){return item.slug===peak.dataset.slug;})[0],scroll=poster.querySelector('.alpine-perspective-scroll'),marker=peak.querySelector('.ribbon-marker'),scrollBox=scroll.getBoundingClientRect(),markerBox=marker.getBoundingClientRect(),x=markerBox.left-scrollBox.left+markerBox.width/2,y=markerBox.top-scrollBox.top;inspector.hidden=false;inspector.innerHTML='<p>'+esc(p.range)+' range</p><div><button type="button" data-cluster-slug="'+esc(p.slug)+'"><strong>'+esc(p.name)+'</strong><span>'+n(p.elev)+' ft · open record</span></button></div>';inspector.style.left=Math.max(16,Math.min(scrollBox.width-16,x))+'px';inspector.style.top=Math.max(16,y-10)+'px';inspector.classList.toggle('opens-down',y<92);inspector.querySelector('[data-cluster-slug]').addEventListener('click',function(){activatePeak(p.slug,true,true);});}
    function hidePeak(){inspector.hidden=true;}
    terrainScroll.addEventListener('mouseleave',hidePeak);
    Array.prototype.slice.call(poster.querySelectorAll('.alpine-3d-peak')).forEach(function(peak){peak.addEventListener('mouseenter',function(){showPeak(peak);});peak.addEventListener('mouseleave',hidePeak);peak.addEventListener('focus',function(){showPeak(peak);});peak.addEventListener('blur',hidePeak);peak.addEventListener('click',function(){activatePeak(peak.dataset.slug,true,true);});peak.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();activatePeak(peak.dataset.slug,true,true);}});});
  }

  function renderTerrain3D(peaks,summits){
    var done=peaks.filter(function(p){return !!summits[p.slug];}),remaining=peaks.length-done.length,progress=Math.round((done.length/peaks.length)*100),highest=done.length?done.slice().sort(function(a,b){return b.elev-a.elev;})[0]:null,next=peaks.slice().sort(function(a,b){return b.elev-a.elev;}).filter(function(p){return !summits[p.slug];})[0]||null,rangesStarted=ranges.filter(function(range){return peaks.some(function(p){return p.range===range&&!!summits[p.slug];});}).length;
    if(terrainScene){terrainScene.destroy();terrainScene=null;}
    poster.className='poster-pane ribbon-lab-pane treatment-alpine terrain-webgl-pane';
    poster.innerHTML='<div class="ribbon-lab-heading"><div><p class="ribbon-kicker">Your progress</p><h2>Every summit, in space.</h2></div><p>Colorado fourteeners · registered 3D terrain</p></div><div class="ribbon-progress-strip"><div><span>Summited</span><strong>'+done.length+'</strong></div><div><span>Remaining</span><strong>'+remaining+'</strong></div><div class="ribbon-progress-meter"><span><i style="width:'+progress+'%"></i></span><em>'+progress+'% complete</em></div></div><div class="ribbon-insights"><div><span>Highest reached</span><strong>'+(highest?esc(shortName(highest.name)):'First summit ahead')+'</strong><em>'+(highest?n(highest.elev)+' ft':'The trail starts here.')+'</em></div><div><span>Highest remaining</span><strong>'+(next?esc(shortName(next.name)):'All clear')+'</strong><em>'+(next?n(next.elev)+' ft':'Every summit logged.')+'</em></div><div><span>Ranges started</span><strong>'+rangesStarted+' <i>/ 6</i></strong><em>One summit opens a range.</em></div></div><div class="ribbon-key"><span class="key done"></span>summited <span class="key"></span>still to climb <span class="terrain-range-key">range rings: '+ranges.map(function(range,index){return '<i class="range-'+index+'"></i>'+esc(range.replace('Tenmile-Mosquito','Tenmile / Mosquito'));}).join('')+'</span></div><div class="terrain-webgl-shell"><div id="terrain3dMap" aria-label="Interactive three-dimensional terrain map of Colorado fourteeners"></div><div class="terrain-map-attribution">USGS 3DEP terrain · USGS aerial imagery · 8× visual relief</div></div><div class="terrain-rotate-note"><button class="terrain-pause" type="button" aria-pressed="false">Pause orbit</button><button class="terrain-reset" type="button">Reset view</button></div><p class="ribbon-help">All 58 summits are framed at start. Drag to orbit, scroll to zoom, and select any summit for details.</p>';
    var mapRoot=poster.querySelector('#terrain3dMap'),pause=poster.querySelector('.terrain-pause');
    if(!window.TerrainSceneView){mapRoot.innerHTML='<p class="loading">3D terrain is unavailable in this browser. Use the location map below.</p>';return;}
    terrainScene=new window.TerrainSceneView(mapRoot,{peaks:peaks,summits:summits,ranges:ranges,onSelect:function(slug){activatePeak(slug,true,true);},onPause:function(value){pause.textContent=value?'Resume orbit':'Pause orbit';pause.setAttribute('aria-pressed',String(value));}});
    if(activeSlug) terrainScene.setSelected(activeSlug);
    pause.addEventListener('click',function(){terrainScene.setPaused(!terrainScene.paused);pause.textContent=terrainScene.paused?'Resume orbit':'Pause orbit';pause.setAttribute('aria-pressed',String(terrainScene.paused));});
    poster.querySelector('.terrain-reset').addEventListener('click',function(){terrainScene.reset();pause.textContent='Resume orbit';pause.setAttribute('aria-pressed','true');});
  }

  function renderRibbonLab(peaks,summits){
    if(terrainTreatment==='alpine'){renderTerrain3D(peaks,summits);return;}
    var ordered=peaks.slice(),left=42,right=778,base=272,range=438,alpineRoute=['San Juan','Elk','Sawatch','Tenmile-Mosquito','Front','Sangre de Cristo'];
    if(terrainTreatment==='ranges') ordered.sort(function(a,b){return ranges.indexOf(a.range)-ranges.indexOf(b.range)||b.elev-a.elev;});
    else if(terrainTreatment==='alpine') ordered.sort(function(a,b){return a.latlon[1]-b.latlon[1]||a.latlon[0]-b.latlon[0];});
    else ordered.sort(function(a,b){return b.elev-a.elev;});
    var done=ordered.filter(function(p){return !!summits[p.slug];}),remaining=ordered.length-done.length,progress=Math.round((done.length/ordered.length)*100);
    var highest=done.length?done.slice().sort(function(a,b){return b.elev-a.elev;})[0]:null,next=peaks.slice().sort(function(a,b){return b.elev-a.elev;}).filter(function(p){return !summits[p.slug];})[0]||null;
    var rangesStarted=ranges.filter(function(range){return ordered.some(function(p){return p.range===range&&!!summits[p.slug];});}).length;
    var points=[],markersMarkup='',labelsMarkup='',gridMarkup='',terrainMarkup='',rangeMarkup='',alpinePlaced=[],alpineClusters=[],alpineFloor=14000,alpineCeiling=14450,alpineBase=258,alpineHeight=150;
    function alpinePeakY(elevation){return alpineBase-((elevation-alpineFloor)/(alpineCeiling-alpineFloor))*alpineHeight;}
    ordered.forEach(function(p,index){
      var x=left+(right-left)*(index/(ordered.length-1)),y=base-((p.elev-14000)/range)*185;
      if(terrainTreatment==='alpine'&&labTerrain){
        var rawX=left+((p.latlon[1]-labTerrain.westLongitude)/(labTerrain.eastLongitude-labTerrain.westLongitude))*(right-left);
        x=rawX;y=alpinePeakY(p.elev);
      }
      var completed=!!summits[p.slug],selected=p.slug===activeSlug,short=posterName(p.name);
      points.push({x:x,y:y,p:p,rawX:terrainTreatment==='alpine'?x:null});
      if(terrainTreatment!=='alpine'&&(completed||p.slug===activeSlug||index===0||index===ordered.length-1||index%14===0)){
        var dy=index%2?-15:21;
        labelsMarkup+='<text class="ribbon-label '+(completed?'done ':'')+'" x="'+x.toFixed(1)+'" y="'+(y+dy).toFixed(1)+'" text-anchor="middle">'+esc(short)+'<tspan x="'+x.toFixed(1)+'" dy="10">'+n(p.elev)+'′</tspan></text>';
      }
      if(terrainTreatment!=='alpine') markersMarkup+='<g class="ribbon-peak '+(completed?'done ':'')+(selected?'is-selected ':'')+'" data-slug="'+esc(p.slug)+'" data-range="'+esc(p.range)+'" tabindex="0" role="button" aria-label="Open '+esc(p.name)+' details"><line class="ribbon-stem" x1="'+x.toFixed(1)+'" y1="'+y.toFixed(1)+'" x2="'+x.toFixed(1)+'" y2="'+base+'"/><circle class="ribbon-hit" cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="13"/><circle class="ribbon-marker" cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="'+(selected?7:5)+'"/></g>';
    });
    if(terrainTreatment==='alpine'){
      points.forEach(function(point){var last=alpineClusters[alpineClusters.length-1];if(last&&point.rawX-last.lastX<=1){last.points.push(point);last.lastX=point.rawX;}else alpineClusters.push({points:[point],lastX:point.rawX});});
      alpineClusters.forEach(function(cluster){
        var members=cluster.points.map(function(point){return point.p;}),x=cluster.points.reduce(function(total,point){return total+point.x;},0)/cluster.points.length,y=Math.min.apply(null,cluster.points.map(function(point){return point.y;})),doneCount=members.filter(function(p){return !!summits[p.slug];}).length,selected=members.some(function(p){return p.slug===activeSlug;}),slugs=members.map(function(p){return p.slug;}).join(','),title=members.map(function(p){return p.name+' · '+n(p.elev)+' ft';}).join(' | '),rangeIndex=ranges.indexOf(members[0].range);
        markersMarkup+='<g class="ribbon-peak alpine-cluster range-dot-'+rangeIndex+' '+(doneCount?'done ':'')+(selected?'is-selected ':'')+(members.length>1?'is-cluster ':'')+'" data-slugs="'+esc(slugs)+'" tabindex="0" role="button" aria-label="'+(members.length>1?'Open '+members.length+' nearby peaks':'Open '+esc(members[0].name)+' details')+'"><title>'+esc(title)+'</title><circle class="ribbon-hit" cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="13"/><circle class="ribbon-marker" cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="'+(members.length>1?7:selected?7:5)+'"/>'+(members.length>1?'<text class="alpine-cluster-count" x="'+x.toFixed(1)+'" y="'+(y+2.6).toFixed(1)+'">'+members.length+'</text>':'')+'</g>';
      });
    }
    if(terrainTreatment==='topo'){
      [14400,14300,14200,14100,14000].forEach(function(elevation){var y=base-((elevation-14000)/range)*185;gridMarkup+='<path class="ribbon-grid" d="M '+left+' '+y.toFixed(1)+' H '+right+'"/><text class="ribbon-grid-label" x="'+(left+4)+'" y="'+(y-5).toFixed(1)+'">'+n(elevation)+'′</text>';});
      terrainMarkup='<g class="terrain-art topo-art"><path class="terrain-far" d="M 42 272 L 42 226 L 132 174 L 216 227 L 326 153 L 414 222 L 522 165 L 624 221 L 718 182 L 778 232 L 778 272 Z"/><path class="terrain-mid" d="M 42 272 L 42 251 L 120 211 L 194 242 L 290 185 L 365 237 L 462 190 L 548 246 L 653 202 L 735 246 L 778 225 L 778 272 Z"/><path class="terrain-contour" d="M 104 234 Q 156 194 205 229 M 271 219 Q 326 170 378 221 M 449 225 Q 521 183 582 230 M 642 225 Q 704 191 759 231"/><path class="terrain-contour second" d="M 128 244 Q 160 218 185 238 M 298 232 Q 330 199 358 229 M 477 237 Q 523 208 557 238 M 673 239 Q 708 213 738 238"/></g>';
    }else if(terrainTreatment==='alpine'){
      if(labTerrain){
        var terrainPoints=[],ridgeFalloff=5.2;
        for(var sampleIndex=0;sampleIndex<=96;sampleIndex++){
          var sampleX=left+(right-left)*(sampleIndex/96),crestElevation=alpineFloor;
          points.forEach(function(point){crestElevation=Math.max(crestElevation,point.p.elev-Math.abs(point.x-sampleX)*ridgeFalloff);});
          terrainPoints.push({x:sampleX,y:alpinePeakY(crestElevation)});
        }
        var firstTerrainPoint=terrainPoints[0],lastTerrainPoint=terrainPoints[terrainPoints.length-1],terrainRidge='L '+firstTerrainPoint.x.toFixed(1)+' '+firstTerrainPoint.y.toFixed(1);
        for(var ridgeIndex=1;ridgeIndex<terrainPoints.length-1;ridgeIndex++){var ridgePoint=terrainPoints[ridgeIndex],nextRidgePoint=terrainPoints[ridgeIndex+1],midX=(ridgePoint.x+nextRidgePoint.x)/2,midY=(ridgePoint.y+nextRidgePoint.y)/2;terrainRidge+=' Q '+ridgePoint.x.toFixed(1)+' '+ridgePoint.y.toFixed(1)+' '+midX.toFixed(1)+' '+midY.toFixed(1);}
        terrainRidge+=' L '+lastTerrainPoint.x.toFixed(1)+' '+lastTerrainPoint.y.toFixed(1);
        var terrainProfile='M '+left+' '+alpineBase+' '+terrainRidge+' L '+right+' '+alpineBase+' Z';
        var terrainContour='M '+firstTerrainPoint.x.toFixed(1)+' '+firstTerrainPoint.y.toFixed(1)+terrainRidge.replace(/^L [^ ]+ [^ ]+/,'');
        var scaleElevations=[14000,14100,14200,14300,14400],horizontalGrid=scaleElevations.map(function(elevation){return {elevation:elevation,y:alpinePeakY(elevation)};}),gridPaths=horizontalGrid.map(function(item){return 'M 42 '+item.y.toFixed(1)+' H 778';}).join(' '),gridLabels=horizontalGrid.map(function(item){return '<text class="alpine-y-label" x="52" y="'+(item.y-5).toFixed(1)+'">'+n(item.elevation)+'′</text>';}).join(''),longitudeTicks=[-109,-108,-107,-106,-105].map(function(longitude){return {longitude:longitude,x:left+((longitude-labTerrain.westLongitude)/(labTerrain.eastLongitude-labTerrain.westLongitude))*(right-left)};}),verticalGrid=longitudeTicks.map(function(tick){return 'M '+tick.x.toFixed(1)+' 62 V 272';}).join(' '),longitudeLabels=longitudeTicks.map(function(tick){return '<text class="alpine-x-label" x="'+tick.x.toFixed(1)+'" y="268" text-anchor="middle">'+Math.abs(tick.longitude)+'°W</text>';}).join('');
        var chartGrid='<rect class="alpine-chart-field" x="42" y="62" width="736" height="210" rx="10"/><g class="alpine-chart-grid"><path d="'+gridPaths+' '+verticalGrid+'"/>'+gridLabels+'</g>';
        terrainMarkup='<g class="terrain-art alpine-art"><text class="alpine-terrain-note" x="52" y="81">SUMMIT ELEVATION · WEST → EAST</text>'+chartGrid+'<g class="alpine-axis-labels">'+longitudeLabels+'</g><defs><clipPath id="alpineTerrainClip"><path d="'+terrainProfile+'"/></clipPath></defs><path class="alpine-ground-plane" d="M 42 '+alpineBase+' L 778 '+alpineBase+' L 763 272 L 57 272 Z"/><path class="alpine-ground-grid" d="M 42 '+alpineBase+' L 57 272 M 164 '+alpineBase+' L 173 272 M 286 '+alpineBase+' L 290 272 M 408 '+alpineBase+' L 408 272 M 530 '+alpineBase+' L 526 272 M 652 '+alpineBase+' L 643 272 M 778 '+alpineBase+' L 763 272 M 57 267 H 768"/><path class="alpine-terrain-depth depth-far" d="'+terrainProfile+'" transform="translate(-18 -15)"/><path class="alpine-terrain-depth depth-near" d="'+terrainProfile+'" transform="translate(-9 -7)"/><image class="alpine-real-imagery" href="assets/usgs-colorado-imagery.jpg" x="'+left+'" y="126" width="'+(right-left)+'" height="150" preserveAspectRatio="xMidYMid slice" clip-path="url(#alpineTerrainClip)"/><path class="alpine-real-terrain" d="'+terrainProfile+'"/><path class="alpine-terrain-rim" d="'+terrainContour+'" transform="translate(0 -1)"/><path class="alpine-real-terrain-contour" d="'+terrainContour+'"/><g class="alpine-chart-grid alpine-chart-grid-front"><path d="'+gridPaths+' '+verticalGrid+'"/></g></g>';
      }else terrainMarkup='<g class="terrain-art alpine-art"><circle class="alpine-sun" cx="657" cy="82" r="46"/><path class="alpine-far" d="M 42 272 L 42 238 L 130 188 L 209 235 L 312 164 L 395 231 L 494 182 L 590 241 L 692 175 L 778 239 L 778 272 Z"/><path class="alpine-ridge" d="M 42 272 L 42 258 L 132 228 L 214 254 L 320 196 L 389 250 L 482 209 L 567 255 L 678 204 L 778 248 L 778 272 Z"/></g>';
      ranges.forEach(function(rangeName,rangeIndex){
        var chapter=points.filter(function(point){return point.p.range===rangeName;}),complete=chapter.filter(function(point){return !!summits[point.p.slug];}).length;
        if(chapter.length){
          var start=chapter[0].x,end=chapter[chapter.length-1].x,mid=(start+end)/2,outline='M '+start.toFixed(1)+' '+base+' '+chapter.map(function(point){return 'L '+point.x.toFixed(1)+' '+point.y.toFixed(1);}).join(' ')+' L '+end.toFixed(1)+' '+base+' Z';
          rangeMarkup+='<g class="alpine-range zone-'+rangeIndex+'"><path d="'+outline+'"/><line x1="'+start.toFixed(1)+'" y1="'+(base+3)+'" x2="'+start.toFixed(1)+'" y2="'+(base+19)+'"/><text x="'+mid.toFixed(1)+'" y="'+(base+18)+'">'+esc(rangeName)+'<tspan x="'+mid.toFixed(1)+'" dy="9">'+complete+' / '+chapter.length+'</tspan></text></g>';
        }
      });
    }else{
      ranges.forEach(function(rangeName,rangeIndex){
        var first=-1,last=-1,complete=0;
        ordered.forEach(function(p,index){if(p.range===rangeName){if(first<0)first=index;last=index;if(summits[p.slug])complete++;}});
        if(first>=0){
          var start=left+(right-left)*(first/(ordered.length-1)),end=left+(right-left)*(last/(ordered.length-1)),mid=(start+end)/2,peakY=202+(rangeIndex%2)*15;
          rangeMarkup+='<g class="range-zone zone-'+rangeIndex+'"><path d="M '+start.toFixed(1)+' '+base+' L '+start.toFixed(1)+' 248 L '+mid.toFixed(1)+' '+peakY+' L '+end.toFixed(1)+' 246 L '+end.toFixed(1)+' '+base+' Z"/><text x="'+mid.toFixed(1)+'" y="306">'+esc(rangeName)+' · '+complete+'/'+(last-first+1)+'</text></g>';
        }
      });
    }
    if(terrainTreatment==='alpine') rangeMarkup='';
    var line=points.map(function(point,index){var newRange=terrainTreatment==='alpine'&&index&&point.p.range!==points[index-1].p.range;return (index===0||newRange?'M ':'L ')+point.x.toFixed(1)+' '+point.y.toFixed(1);}).join(' ');
    var area;
    if(terrainTreatment==='alpine'){
      area='';
      var start=0;
      points.forEach(function(point,index){if(index===points.length-1||points[index+1].p.range!==point.p.range){var chapter=points.slice(start,index+1);area+='M '+chapter[0].x.toFixed(1)+' '+base+' '+chapter.map(function(item){return 'L '+item.x.toFixed(1)+' '+item.y.toFixed(1);}).join(' ')+' L '+chapter[chapter.length-1].x.toFixed(1)+' '+base+' Z ';start=index+1;}});
    }else area='M '+points[0].x.toFixed(1)+' '+base+' '+points.map(function(point){return 'L '+point.x.toFixed(1)+' '+point.y.toFixed(1);}).join(' ')+' L '+points[points.length-1].x.toFixed(1)+' '+base+' Z';
    var displayBase=terrainTreatment==='alpine'?alpineBase:base,treatmentNames={topo:'Topo ridgeline',alpine:'Alpine print',ranges:'Range bands'};
    poster.className='poster-pane ribbon-lab-pane treatment-'+terrainTreatment;
    poster.innerHTML='<div class="ribbon-lab-heading"><div><p class="ribbon-kicker">Your progress</p><h2>Every summit, in view.</h2></div><p>Colorado fourteeners · '+treatmentNames[terrainTreatment]+'</p></div><div class="ribbon-progress-strip"><div><span>Summited</span><strong>'+done.length+'</strong></div><div><span>Remaining</span><strong>'+remaining+'</strong></div><div class="ribbon-progress-meter"><span><i style="width:'+progress+'%"></i></span><em>'+progress+'% complete</em></div></div><div class="ribbon-insights"><div><span>Highest reached</span><strong>'+(highest?esc(shortName(highest.name)):'First summit ahead')+'</strong><em>'+(highest?n(highest.elev)+' ft':'The trail starts here.')+'</em></div><div><span>Highest remaining</span><strong>'+(next?esc(shortName(next.name)):'All clear')+'</strong><em>'+(next?n(next.elev)+' ft':'Every summit logged.')+'</em></div><div><span>Ranges started</span><strong>'+rangesStarted+' <i>/ 6</i></strong><em>One summit opens a range.</em></div></div><div class="terrain-switcher" role="group" aria-label="Terrain treatment"><span>Terrain</span><button type="button" data-terrain="topo" aria-pressed="'+(terrainTreatment==='topo')+'">Topo</button><button type="button" data-terrain="alpine" aria-pressed="'+(terrainTreatment==='alpine')+'">Alpine</button><button type="button" data-terrain="ranges" aria-pressed="'+(terrainTreatment==='ranges')+'">Ranges</button></div><div class="ribbon-key"><span class="key done"></span>summited <span class="key"></span>still to climb</div><div class="ribbon-scroll alpine-ribbon-scroll"><svg class="ribbon terrain-'+terrainTreatment+'" viewBox="0 0 820 340" role="img" aria-label="Colorado fourteeners elevation ribbon showing '+done.length+' summited and '+remaining+' remaining"><defs><linearGradient id="ribbonArea" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#7ca8a0" stop-opacity=".66"/><stop offset="1" stop-color="#365f52" stop-opacity=".05"/></linearGradient><pattern id="topoGrain" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r=".7"/><circle cx="9" cy="7" r=".45"/></pattern></defs>'+terrainMarkup+rangeMarkup+gridMarkup+'<path class="ribbon-baseline" d="M '+left+' '+displayBase+' H '+right+'"/><path class="ribbon-area" d="'+area+'"/><path class="ribbon-line" d="'+line+'"/>'+markersMarkup+labelsMarkup+'<text class="ribbon-axis-label" x="'+right+'" y="'+(base+22)+'" text-anchor="end">14,438′</text></svg>'+(terrainTreatment==='alpine'?'<div class="alpine-inspector" aria-live="polite" hidden></div>':'')+'</div><p class="ribbon-help">'+(terrainTreatment==='alpine'?'Summit ridge uses each fourteeners listed elevation, west to east; USGS aerial imagery supplies the terrain texture. ':'')+'Each marker is a summit. Click one to open its climb record and location.</p>';
    if(terrainTreatment==='alpine'){
      var switcher=poster.querySelector('.terrain-switcher');if(switcher)switcher.remove();
      var summary='<div class="range-photo-heading"><strong>Colorado mountain ranges</strong><span>real range views · summited / total</span></div><div class="range-photo-grid" aria-label="Colorado mountain range photographs">'+ranges.map(function(rangeName,index){var rangePeaks=peaks.filter(function(p){return p.range===rangeName;}),complete=rangePeaks.filter(function(p){return !!summits[p.slug];}).length,photo=rangePhotos[rangeName];return '<a class="range-photo range-color-'+index+'" href="'+photo.source+'" target="_blank" rel="noopener noreferrer" aria-label="View source and license for '+esc(rangeName)+' photograph"><img src="'+photo.src+'" alt="'+esc(rangeName)+' in Colorado" loading="lazy" decoding="async"><span class="range-photo-shade"></span><span class="range-photo-copy"><strong>'+esc(rangeName.replace('-', ' / '))+'</strong><em>'+complete+' / '+rangePeaks.length+' summited</em></span><span class="range-photo-credit">'+esc(photo.credit)+' ↗</span></a>';}).join('')+'</div>';
      poster.querySelector('.ribbon-scroll').insertAdjacentHTML('afterend',summary);
      poster.querySelector('.ribbon-help').textContent='Hover or select a summit mark to inspect it. Numbered marks contain nearby peaks.';
      var inspector=poster.querySelector('.alpine-inspector');
      function showCluster(peak){
        var slugs=peak.dataset.slugs.split(','),members=slugs.map(function(slug){return peaks.filter(function(p){return p.slug===slug;})[0];}),heading=members.length>1?members.length+' nearby peaks':members[0].name;
        inspector.hidden=false;
        inspector.innerHTML='<p>'+esc(heading)+'</p><div>'+members.map(function(member){return '<button type="button" data-cluster-slug="'+esc(member.slug)+'"><strong>'+esc(member.name)+'</strong><span>'+n(member.elev)+' ft · '+esc(member.range)+'</span></button>';}).join('')+'</div>';
        var scroll=poster.querySelector('.alpine-ribbon-scroll'),marker=peak.querySelector('.ribbon-marker'),scrollBox=scroll.getBoundingClientRect(),markerBox=marker.getBoundingClientRect(),x=markerBox.left-scrollBox.left+markerBox.width/2,y=markerBox.top-scrollBox.top;
        inspector.style.left=Math.max(16,Math.min(scrollBox.width-16,x))+'px';
        inspector.style.top=Math.max(16,y-10)+'px';
        inspector.classList.toggle('opens-down',y<92);
        Array.prototype.slice.call(inspector.querySelectorAll('[data-cluster-slug]')).forEach(function(button){button.addEventListener('click',function(){activatePeak(button.dataset.clusterSlug,true,true);});});
      }
      Array.prototype.slice.call(poster.querySelectorAll('.ribbon-peak')).forEach(function(peak){
        peak.addEventListener('mouseenter',function(){showCluster(peak);});
        peak.addEventListener('focus',function(){showCluster(peak);});
        peak.addEventListener('click',function(){var slugs=peak.dataset.slugs.split(',');showCluster(peak);if(slugs.length===1)activatePeak(slugs[0],true,true);});
        peak.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();var slugs=peak.dataset.slugs.split(',');showCluster(peak);if(slugs.length===1)activatePeak(slugs[0],true,true);}});
      });
    }else{
      Array.prototype.slice.call(poster.querySelectorAll('[data-terrain]')).forEach(function(button){button.addEventListener('click',function(){terrainTreatment=button.dataset.terrain;renderRibbonLab(peaks,summits);});});
      Array.prototype.slice.call(poster.querySelectorAll('.ribbon-peak')).forEach(function(peak){
        peak.addEventListener('click',function(){activatePeak(peak.dataset.slug,true,true);});
        peak.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();activatePeak(peak.dataset.slug,true,true);}});
      });
    }
  }

  function renderStats(peaks,summits,by){
    var done=peaks.filter(function(p){return !!summits[p.slug];});
    var highest=done.length?done.reduce(function(a,b){return a.elev>b.elev?a:b;}):null;
    var finished=ranges.filter(function(r){return by[r].every(function(p){return !!summits[p.slug];});}).length;
    stats.innerHTML='<div class="stat"><p class="stat-label">Summited</p><p class="stat-value">'+done.length+' <span>/ 58</span></p><p class="stat-note">Every filled peak is a day above 14,000 feet.</p></div><div class="stat"><p class="stat-label">Highest</p><p class="stat-value">'+(highest?esc(shortName(highest.name)):'—')+'</p><p class="stat-note">'+(highest?n(highest.elev)+' ft':'The first summit is waiting.')+'</p></div><div class="stat"><p class="stat-label">Ranges complete</p><p class="stat-value">'+finished+' <span>/ 6</span></p><p class="stat-note">Sawatch through San Juan.</p></div>';
  }

  function renderList(by,summits){
    var html='';
    ranges.forEach(function(range){
      var complete=by[range].filter(function(p){return !!summits[p.slug];}).length;
      html+='<section class="range"><button class="range-toggle" type="button" aria-expanded="false"><span class="range-title">'+esc(range)+'</span><span class="range-summary">'+complete+' / '+by[range].length+' summited</span><span class="chevron">+</span></button><div class="range-peaks" hidden>';
      by[range].forEach(function(p){
        var s=summits[p.slug],status=s?'Summited '+date(s.date):'Not yet summited';
        var trail='https://www.alltrails.com/search?q='+encodeURIComponent(p.name+' Colorado');
        html+='<div class="peak-row" id="peak-'+esc(p.slug)+'"><button class="peak-toggle" type="button" aria-expanded="false"><span class="rank">'+(p.ranked?'#':'—')+'</span><span class="peak-name">'+esc(p.name)+(p.ranked?'':'<span class="unranked">unranked</span>')+'</span><span class="peak-meta">'+n(p.elev)+' ft · class '+p.class+'</span><span class="chevron">+</span></button><div class="peak-detail" hidden><p>'+status+(s&&s.note?' · '+esc(s.note):'')+'</p><div class="peak-links"><a href="'+trail+'" target="_blank" rel="noopener">AllTrails ↗</a><a href="https://www.14ers.com/14ers" target="_blank" rel="noopener">14ers.com ↗</a>'+(s&&s.strava?'<a href="'+esc(s.strava)+'" target="_blank" rel="noopener">Strava ↗</a>':'')+'</div></div></div>';
      });
      html+='</div></section>';
    });
    list.innerHTML=html;
    Array.prototype.slice.call(document.querySelectorAll('.range-toggle')).forEach(function(button){
      button.addEventListener('click',function(){var range=button.parentNode;setRangeOpen(range,!hasClass(range,'open'));});
    });
    Array.prototype.slice.call(document.querySelectorAll('.peak-toggle')).forEach(function(button){
      button.addEventListener('click',function(){
        var row=button.parentNode,slug=row.id.replace('peak-','');
        if(hasClass(row,'open')) setRowOpen(row,false); else activatePeak(slug,false,true);
      });
    });
  }

  function renderLeafletMap(peaks,summits){
    if(!locationMap) return;
    if(!window.L){locationMap.innerHTML='<div class="map-unavailable"><strong>Terrain map unavailable.</strong><br>Check your connection, then reload.</div>';return;}
    locationMap.innerHTML='';
    leafletMap=L.map(locationMap,{scrollWheelZoom:false,zoomControl:true,attributionControl:true,zoomSnap:.25,zoomAnimation:false,fadeAnimation:false});
    var topoTilesRequested=0,topoTilesLoaded=0,usingFallback=false,topoLayer;
    function useTopographicFallback(){
      if(usingFallback||!leafletMap)return;
      usingFallback=true;
      if(topoLayer) leafletMap.removeLayer(topoLayer);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',{maxZoom:17,attribution:'Tiles &copy; Esri — Sources: Esri, USGS, NOAA'}).addTo(leafletMap);
    }
    topoLayer=L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{maxZoom:17,attribution:'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="https://opentopomap.org">OpenTopoMap</a>'});
    topoLayer.on('loading',function(){topoTilesRequested++;});
    topoLayer.on('load',function(){topoTilesLoaded++;});
    topoLayer.on('tileerror',useTopographicFallback);
    topoLayer.addTo(leafletMap);
    setTimeout(function(){if(!usingFallback&&topoTilesRequested&&topoTilesLoaded===0)useTopographicFallback();},8000);
    var bounds=L.latLngBounds(peaks.map(function(p){return p.latlon;}));
    leafletMap.fitBounds(bounds.pad(.16),{animate:false});
    L.control.scale({imperial:true,metric:false,position:'bottomright'}).addTo(leafletMap);
    var legend=L.control({position:'bottomleft'});
    legend.onAdd=function(){var div=L.DomUtil.create('div','map-legend');div.innerHTML='<span class="key done"></span>Summited <span class="key"></span>Still to climb';return div;};
    legend.addTo(leafletMap);
    peaks.forEach(function(p){
      var done=!!summits[p.slug];
      var style={radius:7,fillColor:done?'#d69a3a':'#315d5c',color:'#f7f2e6',weight:2,opacity:1,fillOpacity:1};
      markerStyles[p.slug]=style;
      var marker=L.circleMarker(p.latlon,style).addTo(leafletMap);
      marker.bindTooltip(esc(shortName(p.name))+' · '+n(p.elev)+' ft',{direction:'top',offset:[0,-6],opacity:.96});
      marker.bindPopup('<div class="summit-popup"><strong>'+esc(p.name)+'</strong><span>'+n(p.elev)+' ft · class '+p.class+'</span><span class="'+(done?'status-done':'status-open')+'">'+(done?'Summited':'Still to climb')+'</span></div>');
      marker.on('click',function(){activatePeak(p.slug,true,false);});
      markers[p.slug]=marker;
    });
    setTimeout(function(){if(leafletMap)leafletMap.invalidateSize();},80);
  }

  Promise.all([
    fetch('peaks.json').then(function(r){if(!r.ok)throw 0;return r.json();}),
    fetch('summits.json',{cache:'no-store'}).then(function(r){if(!r.ok)throw 0;return r.json();}),
    fetch('terrain-profile.json').then(function(r){if(!r.ok)throw 0;return r.json();})
  ]).then(function(data){
    var peaks=data[0],summits=data[1]||{},by={};
    if(!Array.isArray(peaks)||peaks.length!==58)throw 0;
    ranges.forEach(function(range){by[range]=[];});
    peaks.forEach(function(p){by[p.range].push(p);});
    if(widgetLab){
      labPeaks=peaks;
      labSummits=summits;
      renderRibbonLab(peaks,summits);
    }else{
      poster.innerHTML=posterMarkup(peaks,summits);
    }
    renderStats(peaks,summits,by);
    renderList(by,summits);
    renderLeafletMap(peaks,summits);
    if(!widgetLab) Array.prototype.slice.call(document.querySelectorAll('.poster-peak')).forEach(function(peak){
      peak.addEventListener('click',function(){activatePeak(peak.dataset.slug,true,true);});
      peak.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();activatePeak(peak.dataset.slug,true,true);}});
    });
  }).catch(fail);
})();
