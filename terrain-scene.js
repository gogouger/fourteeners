(function(){
  'use strict';

  var RAD=Math.PI/180;
  function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
  function perspective(fov,aspect,near,far){
    var f=1/Math.tan(fov/2),range=1/(near-far);
    return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(near+far)*range,-1,0,0,2*near*far*range,0]);
  }
  function lookAt(eye,target,up){
    var zx=eye[0]-target[0],zy=eye[1]-target[1],zz=eye[2]-target[2],zl=Math.hypot(zx,zy,zz)||1;
    zx/=zl;zy/=zl;zz/=zl;
    var xx=up[1]*zz-up[2]*zy,xy=up[2]*zx-up[0]*zz,xz=up[0]*zy-up[1]*zx,xl=Math.hypot(xx,xy,xz)||1;
    xx/=xl;xy/=xl;xz/=xl;
    var yx=zy*xz-zz*xy,yy=zz*xx-zx*xz,yz=zx*xy-zy*xx;
    return new Float32Array([xx,yx,zx,0,xy,yy,zy,0,xz,yz,zz,0,-(xx*eye[0]+xy*eye[1]+xz*eye[2]),-(yx*eye[0]+yy*eye[1]+yz*eye[2]),-(zx*eye[0]+zy*eye[1]+zz*eye[2]),1]);
  }
  function multiply(a,b){
    var out=new Float32Array(16);
    for(var c=0;c<4;c++)for(var r=0;r<4;r++)out[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];
    return out;
  }
  function project(point,matrix,width,height){
    var x=point[0],y=point[1],z=point[2],w=matrix[3]*x+matrix[7]*y+matrix[11]*z+matrix[15];
    if(w<=0)return null;
    var px=(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12])/w,py=(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])/w;
    return {x:(px*.5+.5)*width,y:(1-(py*.5+.5))*height,visible:px>-1.16&&px<1.16&&py>-1.16&&py<1.16};
  }
  function shader(gl,type,source){var s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
  function program(gl,vertex,fragment){var p=gl.createProgram();gl.attachShader(p,shader(gl,gl.VERTEX_SHADER,vertex));gl.attachShader(p,shader(gl,gl.FRAGMENT_SHADER,fragment));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p;}
  function mercatorY(lat){var rad=lat*RAD;return Math.log(Math.tan(Math.PI/4+rad/2));}

  function TerrainSceneView(root,options){
    this.root=root;this.options=options;this.yaw=.42;this.pitch=.46;this.distance=5.7;this.paused=false;this.drag=null;this.selected=null;this.markers=[];this.raf=0;this.last=0;
    this.canvas=document.createElement('canvas');this.canvas.className='terrain-scene-canvas';this.canvas.setAttribute('aria-hidden','true');
    this.overlay=document.createElement('div');this.overlay.className='terrain-scene-markers';
    root.appendChild(this.canvas);root.appendChild(this.overlay);
    this.gl=this.canvas.getContext('webgl',{antialias:true,alpha:false,depth:true})||this.canvas.getContext('experimental-webgl');
    this.bind();this.load();
  }
  TerrainSceneView.prototype.bind=function(){
    var self=this;
    this.root.addEventListener('pointerdown',function(e){if(e.button!==0||e.target.closest('button'))return;self.drag={id:e.pointerId,x:e.clientX,y:e.clientY,yaw:self.yaw,pitch:self.pitch};self.paused=true;self.root.setPointerCapture(e.pointerId);self.options.onPause(true);});
    this.root.addEventListener('pointermove',function(e){if(!self.drag||e.pointerId!==self.drag.id)return;self.yaw=self.drag.yaw-(e.clientX-self.drag.x)*.007;self.pitch=clamp(self.drag.pitch+(e.clientY-self.drag.y)*.004,.42,.9);});
    function release(e){if(self.drag&&e.pointerId===self.drag.id)self.drag=null;}
    this.root.addEventListener('pointerup',release);this.root.addEventListener('pointercancel',release);
    this.root.addEventListener('wheel',function(e){e.preventDefault();self.distance=clamp(self.distance+e.deltaY*.003,3.9,8.5);self.paused=true;self.options.onPause(true);},{passive:false});
    window.addEventListener('resize',function(){self.resize();});
  };
  TerrainSceneView.prototype.load=async function(){
    try{
      var manifest=await fetch('assets/terrain-scene/terrain-manifest.json?v=terrain-scene-2',{cache:'no-cache'}).then(function(r){if(!r.ok)throw new Error('terrain manifest');return r.json();});
      var height=await fetch('assets/terrain-scene/heightmap.bin').then(function(r){if(!r.ok)throw new Error('terrain heightmap');return r.arrayBuffer();});
      var image=await new Promise(function(resolve,reject){var i=new Image();i.onload=function(){resolve(i);};i.onerror=reject;i.src='assets/terrain-scene/imagery.jpg';});
      this.manifest=manifest;this.heights=new Uint16Array(height);this.image=image;this.ready();
    }catch(error){this.root.innerHTML='<p class="loading">High-resolution terrain could not load. Try reloading.</p>';}
  };
  TerrainSceneView.prototype.ready=function(){
    if(!this.gl){this.root.innerHTML='<p class="loading">3D terrain needs WebGL. Use the terrain map below in this browser.</p>';return;}
    var gl=this.gl;
    if(!gl.getExtension('OES_element_index_uint')){this.root.innerHTML='<p class="loading">3D terrain needs standard WebGL index support. Use the terrain map below in this browser.</p>';return;}
    this.sceneProgram=program(gl,'attribute vec3 p;attribute vec3 n;attribute vec2 uv;uniform mat4 mvp;varying vec3 light;varying vec2 tex;void main(){vec3 l=normalize(vec3(-.4,.55,.8));light=vec3(.55)+max(dot(normalize(n),l),0.0)*.55;tex=uv;gl_Position=mvp*vec4(p,1.0);}','precision mediump float;varying vec3 light;varying vec2 tex;uniform sampler2D aerial;void main(){vec3 color=texture2D(aerial,tex).rgb;gl_FragColor=vec4(color*light,1.0);}');
    this.lineProgram=program(gl,'attribute vec3 p;uniform mat4 mvp;void main(){gl_Position=mvp*vec4(p,1.0);}','precision mediump float;uniform vec4 color;void main(){gl_FragColor=color;}');
    this.makeMesh();this.makeTexture();this.makeMarkers();this.resize();this.animate(0);
  };
  TerrainSceneView.prototype.heightAt=function(u,v){
    var size=this.manifest.heightSize,x=clamp(u,0,1)*(size-1),y=clamp(v,0,1)*(size-1),x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(size-1,x0+1),y1=Math.min(size-1,y0+1),fx=x-x0,fy=y-y0,h=this.heights,a=h[y0*size+x0]*(1-fx)+h[y0*size+x1]*fx,b=h[y1*size+x0]*(1-fx)+h[y1*size+x1]*fx;
    return this.manifest.minElevation+(a*(1-fy)+b*fy)*this.manifest.heightUnit;
  };
  TerrainSceneView.prototype.worldAt=function(lat,lon,offset){
    var b=this.manifest.bounds,west=b[0],south=b[1],east=b[2],north=b[3],u=(lon-west)/(east-west),top=mercatorY(north),bottom=mercatorY(south),v=(top-mercatorY(lat))/(top-bottom),extent=this.manifest.extent,height=this.heightAt(u,v)-this.manifest.minElevation;
    return [(u-.5)*extent[0],(.5-v)*extent[1],height*this.manifest.reliefScale+(offset||0)];
  };
  TerrainSceneView.prototype.makeMesh=function(){
    var grid=this.manifest.meshSize,positions=new Float32Array(grid*grid*3),normals=new Float32Array(grid*grid*3),uvs=new Float32Array(grid*grid*2),indices=new Uint32Array((grid-1)*(grid-1)*6),extent=this.manifest.extent,i=0;
    for(var y=0;y<grid;y++)for(var x=0;x<grid;x++,i++){var u=x/(grid-1),v=y/(grid-1),point=this.worldAt(this.manifest.bounds[3]-(this.manifest.bounds[3]-this.manifest.bounds[1])*v,this.manifest.bounds[0]+(this.manifest.bounds[2]-this.manifest.bounds[0])*u);positions[i*3]=point[0];positions[i*3+1]=point[1];positions[i*3+2]=point[2];uvs[i*2]=u;uvs[i*2+1]=v;}
    for(y=0;y<grid;y++)for(x=0;x<grid;x++){var left=Math.max(0,x-1),right=Math.min(grid-1,x+1),up=Math.max(0,y-1),down=Math.min(grid-1,y+1),hl=positions[(y*grid+left)*3+2],hr=positions[(y*grid+right)*3+2],hu=positions[(up*grid+x)*3+2],hd=positions[(down*grid+x)*3+2],nx=hl-hr,ny=hu-hd,nz=((right-left)*extent[0]/(grid-1)+(down-up)*extent[1]/(grid-1))*.5,len=Math.hypot(nx,ny,nz)||1,ni=(y*grid+x)*3;normals[ni]=nx/len;normals[ni+1]=ny/len;normals[ni+2]=nz/len;}
    i=0;for(y=0;y<grid-1;y++)for(x=0;x<grid-1;x++){var a=y*grid+x;indices[i++]=a;indices[i++]=a+1;indices[i++]=a+grid;indices[i++]=a+1;indices[i++]=a+grid+1;indices[i++]=a+grid;}
    var gl=this.gl;this.mesh={count:indices.length};
    this.mesh.attributes={p:gl.createBuffer(),n:gl.createBuffer(),uv:gl.createBuffer()};gl.bindBuffer(gl.ARRAY_BUFFER,this.mesh.attributes.p);gl.bufferData(gl.ARRAY_BUFFER,positions,gl.STATIC_DRAW);gl.bindBuffer(gl.ARRAY_BUFFER,this.mesh.attributes.n);gl.bufferData(gl.ARRAY_BUFFER,normals,gl.STATIC_DRAW);gl.bindBuffer(gl.ARRAY_BUFFER,this.mesh.attributes.uv);gl.bufferData(gl.ARRAY_BUFFER,uvs,gl.STATIC_DRAW);this.mesh.index=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.mesh.index);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);
    var outline=[];for(x=0;x<grid;x+=8){outline.push(positions[x*3],positions[x*3+1],positions[x*3+2]+.003);}this.gridBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.gridBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(outline),gl.STATIC_DRAW);this.gridCount=outline.length/3;
  };
  TerrainSceneView.prototype.makeTexture=function(){var gl=this.gl,t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,1);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.image);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.generateMipmap(gl.TEXTURE_2D);this.texture=t;};
  TerrainSceneView.prototype.makeMarkers=function(){var self=this;this.options.peaks.forEach(function(peak){var button=document.createElement('button'),rangeIndex=self.options.ranges.indexOf(peak.range);button.type='button';button.className='terrain-summit-marker range-'+rangeIndex+' '+(self.options.summits[peak.slug]?'done ':'')+(self.selected===peak.slug?'is-selected ':'');button.setAttribute('aria-label','Open '+peak.name+' details');button.title=peak.name+' · '+Number(peak.elev).toLocaleString('en-US')+' ft · '+peak.range;button.addEventListener('click',function(){self.options.onSelect(peak.slug);});button.addEventListener('mouseenter',function(){button.dataset.label=peak.name.replace(/^Mount /,'Mt. ');});button.addEventListener('mouseleave',function(){delete button.dataset.label;});self.overlay.appendChild(button);self.markers.push({slug:peak.slug,point:self.worldAt(peak.latlon[0],peak.latlon[1],.035),button:button});});};
  TerrainSceneView.prototype.resize=function(){var rect=this.root.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);if(!rect.width||!this.gl)return;this.width=Math.round(rect.width);this.height=Math.round(rect.height);this.canvas.width=Math.round(rect.width*dpr);this.canvas.height=Math.round(rect.height*dpr);this.gl.viewport(0,0,this.canvas.width,this.canvas.height);};
  TerrainSceneView.prototype.matrix=function(){var radius=this.distance,cp=Math.cos(this.pitch),eye=[Math.sin(this.yaw)*cp*radius,-Math.cos(this.yaw)*cp*radius,Math.sin(this.pitch)*radius+.3],target=[0,0,.24];return multiply(perspective(44*RAD,this.width/this.height,.05,20),lookAt(eye,target,[0,0,1]));};
  TerrainSceneView.prototype.draw=function(time){if(!this.ready)return;var gl=this.gl,mvp=this.matrix(),p=this.sceneProgram;gl.clearColor(.73,.79,.71,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.useProgram(p);function attr(name,buffer,size){var loc=gl.getAttribLocation(p,name);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,0,0);}attr('p',this.mesh.attributes.p,3);attr('n',this.mesh.attributes.n,3);attr('uv',this.mesh.attributes.uv,2);gl.uniformMatrix4fv(gl.getUniformLocation(p,'mvp'),false,mvp);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.uniform1i(gl.getUniformLocation(p,'aerial'),0);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.mesh.index);gl.drawElements(gl.TRIANGLES,this.mesh.count,gl.UNSIGNED_INT,0);
    var shell=this.root.getBoundingClientRect();this.markers.forEach(function(marker){var at=project(marker.point,mvp,shell.width,shell.height);marker.button.style.display=at&&at.visible?'block':'none';if(at){marker.button.style.transform='translate('+at.x+'px,'+at.y+'px) translate(-50%,-50%)';}});
  };
  TerrainSceneView.prototype.animate=function(now){var self=this;if(!this.paused&&!this.drag&&this.last)this.yaw+=(now-this.last)*.000035;this.last=now;this.draw(now);this.raf=requestAnimationFrame(function(t){self.animate(t);});};
  TerrainSceneView.prototype.setPaused=function(value){this.paused=!!value;};
  TerrainSceneView.prototype.reset=function(){this.yaw=.42;this.pitch=.46;this.distance=5.7;this.paused=true;};
  TerrainSceneView.prototype.setSelected=function(slug){this.selected=slug;this.markers.forEach(function(marker){marker.button.classList.toggle('is-selected',marker.slug===slug);});};
  TerrainSceneView.prototype.destroy=function(){if(this.raf)cancelAnimationFrame(this.raf);this.root.innerHTML='';};
  window.TerrainSceneView=TerrainSceneView;
})();
