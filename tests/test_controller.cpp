#include "../src/Controller.h"
#include <assert.h>
#include <stdio.h>
int main(){
 GreenhouseController c;Readings r;
 c.sample(r);c.tick(0);assert(!c.out.pump&&!c.out.fan&&!c.out.lamp);
 c.reset();r.temperature=32;c.sample(r);c.tick(0);assert(c.out.fan);
 r.temperature=27;for(int i=0;i<50;i++)c.sample(r);c.tick(100);assert(c.out.fan);
 r.temperature=26;for(int i=0;i<50;i++)c.sample(r);c.tick(200);assert(!c.out.fan);
 c.reset();r=Readings();r.soil=25;c.sample(r);c.tick(0);assert(c.out.pump);
 c.tick(5999);assert(c.out.pump);c.tick(6000);assert(!c.out.pump&&c.out.cooldown);
 c.tick(17999);assert(!c.out.pump);c.tick(18000);assert(c.out.pump);
 r.water=10;c.sample(r);c.tick(18001);assert(!c.out.pump&&c.out.waterLow);
 c.reset();r=Readings();r.soil=25;r.water=NAN;c.sample(r);c.tick(0);assert(!c.out.pump&&c.out.sensorFault);
 c.reset();r=Readings();r.light=15;c.sample(r);c.tick(0);assert(c.out.lamp);
 r.hour=22;c.sample(r);c.tick(1);assert(!c.out.lamp);
 r.hour=6;c.sample(r);c.tick(2);assert(c.out.lamp);
 r.clockValid=false;c.sample(r);c.tick(3);assert(!c.out.lamp);
 c.reset();r=Readings();r.soil=25;c.sample(r);c.tick(UINT32_MAX-3000);assert(c.out.pump);c.tick(2999);assert(!c.out.pump);
 c.reset();r=Readings();r.temperature=NAN;c.sample(r);c.tick(0);assert(c.out.fan&&c.out.sensorFault);
 printf("PASS: hysteresis, pump timeout/cooldown, low-water safety, invalid sensors, night/time safety, millis rollover\n");
}
