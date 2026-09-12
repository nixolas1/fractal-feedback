export const vertex = `#version 300 es
precision highp float;
out vec2 uv;
void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.0-1.0,0,1); }`;
export const fragment = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 uv;out vec4 frag;
uniform sampler2D uA,uB,uC,uPrev;
uniform vec2 uResolution;
uniform int uKind;
uniform float uTime,uFrame,uSeed,uFeed,uPulse;
uniform float level,mixAmount,crossAmount,mixMode;
uniform float brightness,contrast,hue,saturation,gammaValue,blackLevel,response;
uniform float distanceValue,rotation,xOffset,yOffset,reflection,flipX,flipY,perspective,reflectionAngle,reflectionScale,reflectionX,reflectionY,aberration;
uniform float exposure,focus,sharpness,noiseAmount,warmth,shoulder;
uniform float keyMode,threshold,softness,invertKey;
uniform float flow,diffusion,feed,decay;
uniform float viewExposure,viewGamma;
const float PI=3.14159265359;
vec3 sampleEdge(sampler2D s,vec2 p){if(any(lessThan(p,vec2(0)))||any(greaterThan(p,vec2(1))))return vec3(0);return texture(s,p).rgb;}
vec2 rotate2(vec2 p,float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c)*p;}
vec3 hueRotate(vec3 c,float a){vec3 k=normalize(vec3(1));float s=sin(a),co=cos(a);return c*co+cross(k,c)*s+k*dot(k,c)*(1.-co);}
float random(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233))+uFrame*.173+uSeed)*43758.5453);}
vec2 projected(vec2 q,float angle,bool mirrored){
 float aspect=uResolution.x/uResolution.y;
 vec2 p=(q-.5)*vec2(aspect,1.);
 p+=vec2(xOffset,yOffset);
 p.y/=max(.25,1.+perspective*p.x);
 p=rotate2(p,angle*PI/180.)/distanceValue;
 if(mirrored){p+=vec2(reflectionX,reflectionY);p/=reflectionScale;p.x*=1.-2.*flipX;p.y*=1.-2.*flipY;}
 return p/vec2(aspect,1.)+.5;
}
vec3 lens(sampler2D t,vec2 p){vec2 d=(p-.5)*aberration;return vec3(sampleEdge(t,p+d).r,sampleEdge(t,p).g,sampleEdge(t,p-d).b);}
void main(){
 vec3 a=texture(uA,uv).rgb,b=texture(uB,uv).rgb,c=texture(uC,uv).rgb,col=a;
 if(uKind==0){ col=a*level; }
 if(uKind==1){
   float m=clamp(mixAmount,0.,1.);
   if(uFeed<.5 && uPulse<.5) m=0.;
   if(uPulse>.5)m=max(m,.36);
   if(mixMode<.5)col=mix(a,b,m);
   else if(mixMode<1.5)col=a+b*m;
   else col=abs(a-b*m);
   col=mix(col,c,crossAmount);
 }
 if(uKind==2){
   vec3 signal=hueRotate(a,hue*PI/180.);
   float l=dot(signal,vec3(.2126,.7152,.0722));signal=mix(vec3(l),signal,saturation);
   signal=clamp(signal*contrast+brightness,0.,1.);
   vec3 emitted=pow(signal,vec3(gammaValue));
   emitted=blackLevel+(1.-blackLevel)*emitted;
   col=mix(emitted,texture(uPrev,uv).rgb,response);
 }
 if(uKind==3){
   vec2 p=projected(uv,rotation,false),r=projected(uv,rotation+reflectionAngle,true);
   col=lens(uA,p)*(1.-reflection)+lens(uB,r)*reflection;
 }
 if(uKind==4){
   vec2 d=max(focus,1.)/uResolution;
   vec3 light=a;
   if(focus>.001||sharpness>.001)light=(a*4.+texture(uA,uv+vec2(d.x,0)).rgb+texture(uA,uv-vec2(d.x,0)).rgb+texture(uA,uv+vec2(0,d.y)).rgb+texture(uA,uv-vec2(0,d.y)).rgb)/8.;
   light=mix(a,light,min(focus,1.))+(a-light)*sharpness;
   light*=exp2(exposure)*vec3(1.+warmth*.12,1.,1.-warmth*.12);
   light+=noiseAmount*(random(uv)-.5);
   light=max(light,0.);
   light=mix(light,light/(1.+light*.45),shoulder);
   col=pow(clamp(light,0.,1.),vec3(1./gammaValue));
 }
 if(uKind==5){
   float mask=dot(a,vec3(.2126,.7152,.0722));
   if(keyMode>.5&&keyMode<1.5)mask=1.-max(0.,a.g-max(a.r,a.b));
   if(keyMode>1.5)mask=1.-max(0.,a.b-max(a.r,a.g));
   mask=smoothstep(threshold-softness,threshold+softness,mask);
   if(invertKey>.5)mask=1.-mask;
   col=mix(b,a,mask);
 }
 if(uKind==6){
   vec2 px=1./uResolution;
   float north=dot(texture(uA,uv+vec2(0,px.y*2.)).rgb,vec3(.333));
   float south=dot(texture(uA,uv-vec2(0,px.y*2.)).rgb,vec3(.333));
   float east=dot(texture(uA,uv+vec2(px.x*2.,0)).rgb,vec3(.333));
   float west=dot(texture(uA,uv-vec2(px.x*2.,0)).rgb,vec3(.333));
   vec2 curl=vec2(north-south,west-east);
   vec2 pos=uv+curl*flow*.018;
   vec3 moved=texture(uA,pos).rgb;
   vec3 lap=(texture(uA,pos+vec2(px.x,0)).rgb+texture(uA,pos-vec2(px.x,0)).rgb+texture(uA,pos+vec2(0,px.y)).rgb+texture(uA,pos-vec2(0,px.y)).rgb)*.25;
   col=mix(moved,lap,diffusion)*decay;
   col=mix(col,texture(uPrev,uv).rgb,.08);
   if(uFeed>.5||uPulse>.5)col+=b*feed;
 }
 if(uKind==7){col=a;}
 if(uKind==8){col=pow(clamp(a,0.,1.),vec3(1./viewGamma))*exp2(viewExposure);}
 frag=vec4(max(col,vec3(0)),1.);
}`;
export const kindNumbers = {
  source: 0,
  mixer: 1,
  screen: 2,
  optics: 3,
  camera: 4,
  key: 5,
  emulsion: 6,
  output: 7,
};
