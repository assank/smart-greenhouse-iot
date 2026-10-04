#pragma once
#include <stdint.h>
#include <math.h>

struct Readings {
  float temperature=25, humidity=60, soil=45, light=65, water=75;
  int hour=14;
  bool clockValid=true;
};
struct Outputs {
  bool pump=false, fan=false, lamp=false, waterLow=false, sensorFault=false;
  uint32_t pumpStarted=0, pumpStopped=0;
  bool cooldown=false;
};
class GreenhouseController {
 public:
  Readings filtered;
  Outputs out;
  bool initialized=false;
  static bool valid(float v,float low,float high){return isfinite(v)&&v>=low&&v<=high;}
  void reset(){out=Outputs();initialized=false;}
  void sample(const Readings& r){
    if(!initialized){filtered=r;initialized=true;}
    else {
      filtered.temperature=smooth(filtered.temperature,r.temperature,-40,80);
      filtered.humidity=smooth(filtered.humidity,r.humidity,0,100);
      filtered.soil=smooth(filtered.soil,r.soil,0,100);
      filtered.light=smooth(filtered.light,r.light,0,100);
      filtered.water=smooth(filtered.water,r.water,0,100);
      filtered.hour=r.hour;filtered.clockValid=r.clockValid;
    }
    raw=r;
  }
  void tick(uint32_t now){
    if(!initialized)return;
    const bool waterOk=valid(raw.water,0,100);
    const bool soilOk=valid(raw.soil,0,100);
    const bool temperatureOk=valid(raw.temperature,-40,80);
    const bool lightOk=valid(raw.light,0,100);
    out.waterLow=waterOk && (raw.water<=15 || filtered.water<=15);
    out.sensorFault=!waterOk||!soilOk||!temperatureOk||!lightOk||!valid(raw.humidity,0,100);
    const bool irrigationAllowed=waterOk&&soilOk&&!out.waterLow;
    if(out.cooldown && uint32_t(now-out.pumpStopped)>=12000)out.cooldown=false;
    if(out.pump && (!irrigationAllowed || filtered.soil>=55 || uint32_t(now-out.pumpStarted)>=6000)){
      out.pump=false;out.pumpStopped=now;out.cooldown=true;
    }
    if(!out.pump && !out.cooldown && irrigationAllowed && filtered.soil<35){out.pump=true;out.pumpStarted=now;}
    if(!temperatureOk)out.fan=true;
    else if(filtered.temperature>=28.5f)out.fan=true;
    else if(filtered.temperature<=26.5f)out.fan=false;
    const bool night=filtered.hour>=22||filtered.hour<6;
    if(!lightOk||!filtered.clockValid||night)out.lamp=false;
    else if(filtered.light<30)out.lamp=true;
    else if(filtered.light>=45)out.lamp=false;
  }
 private:
  Readings raw;
  static float smooth(float previous,float value,float low,float high){
    if(!valid(value,low,high))return previous;
    return valid(previous,low,high)?previous+0.25f*(value-previous):value;
  }
};
