export class GreenhouseController {
  constructor(){this.reset();}
  reset(){this.initialized=false;this.filtered={};this.raw={};this.out={pump:false,fan:false,lamp:false,waterLow:false,sensorFault:false,pumpStarted:0,pumpStopped:0,cooldown:false};}
  valid(v,lo,hi){return Number.isFinite(v)&&v>=lo&&v<=hi;}
  sample(r){
    if(!this.initialized){this.filtered={...r};this.initialized=true;}
    else {
      for(const [key,lo,hi] of [['temperature',-40,80],['humidity',0,100],['soil',0,100],['light',0,100],['water',0,100]]){
        if(this.valid(r[key],lo,hi))this.filtered[key]=this.valid(this.filtered[key],lo,hi)?this.filtered[key]+.25*(r[key]-this.filtered[key]):r[key];
      }
      this.filtered.hour=r.hour;this.filtered.clockValid=r.clockValid;
    }
    this.raw={...r};
  }
  tick(now){
    if(!this.initialized)return;
    now=now>>>0;
    const r=this.raw,f=this.filtered,o=this.out;
    const waterOk=this.valid(r.water,0,100),soilOk=this.valid(r.soil,0,100),temperatureOk=this.valid(r.temperature,-40,80),lightOk=this.valid(r.light,0,100);
    o.waterLow=waterOk&&(r.water<=15||f.water<=15);
    o.sensorFault=!waterOk||!soilOk||!temperatureOk||!lightOk||!this.valid(r.humidity,0,100);
    const allowed=waterOk&&soilOk&&!o.waterLow;
    if(o.cooldown&&((now-o.pumpStopped)>>>0)>=12000)o.cooldown=false;
    if(o.pump&&(!allowed||f.soil>=55||((now-o.pumpStarted)>>>0)>=6000)){o.pump=false;o.pumpStopped=now;o.cooldown=true;}
    if(!o.pump&&!o.cooldown&&allowed&&f.soil<35){o.pump=true;o.pumpStarted=now;}
    if(!temperatureOk)o.fan=true;else if(f.temperature>=28.5)o.fan=true;else if(f.temperature<=26.5)o.fan=false;
    if(!lightOk||!f.clockValid||f.hour>=22||f.hour<6)o.lamp=false;else if(f.light<30)o.lamp=true;else if(f.light>=45)o.lamp=false;
  }
}
