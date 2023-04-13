# 2D Weather Sandbox

Previously called "Weather_Sim_4"

This projects aims to produce a semirealistic two-dimensional, realtime, interactive simulation of the weather in earth's troposphere.


## Clouds and precipitation
Simulating clouds and precipitation are the main objectives of this project.
All the equations relating to water phase change are simplified versions of the real ones, to improve performance and ease programming.
Precipitation is simulated using discrete particles but can be viualized as both partiles and smooth realistic looking curtains.
![Bui](https://user-images.githubusercontent.com/42830240/160260531-03ecaee1-244b-4eb1-a758-284728e9d9e7.PNG)

Sunlight with realistic colors makes clouds and precipitation look real
![Bui2](https://user-images.githubusercontent.com/42830240/160260597-12e4772e-717b-411d-a3e2-f946fb5c5c3f.PNG)


![Bui5](https://user-images.githubusercontent.com/42830240/160260713-32ffee8a-18a2-45bc-98be-b4396793b466.PNG)


## limitations
Due to the two-dimensional nature of the simulation, it cannot simulate 3D vortices such as tornadoes, dust devils or hurricanes. It can only simulate linear storm systems.


# Example: low intensity cell analysis
Warm moist air is rising into the cloud on the right condensing water and releasing heat until it eventually rises well above the freezing level and forming ice (snow), realeasing even more heat. The snow grows until it descents down under the freezing level and melts into rain, absorbing heat and creating a downdraft. Below the cloud level some of the rain evaporates, absorbing even more heat and strengtening the downward motion. Near the surface the air spreads out sideways and in this case mostly to the right, creating a small low level cold front. This cold front pushes even more warm air up.
![Schermopname (92)_LI](https://user-images.githubusercontent.com/42830240/173361271-23383858-f0d3-485d-91b9-21e0d3c75211.jpg)
The dew points and cape are very low in this example, but it's just enough to form a nice stable cell.
![Naamloos](https://user-images.githubusercontent.com/42830240/173365013-cdea3b40-f470-4390-a8fa-b8d93025d893.png)

# The code

The simulation is based on a very simple fluid simulation topology.
In total the project contains arround 4000 lines of code of wich 2400 in JS and 1500 in GLSL

<insert explanation>

All code was written by me (Niels Daemen) except for the libraries included

## libraries

The simulation and visualization itself is entirely custom js and glsl written by me (Niels Daemen). The sounding graph, keyboard and mouse controls are also custom code. The simulation can run and be partly controlled without any libraries. I do however use the following libraries for part of the user interface and file compression:

DatGui: Used for the user interface because it's very easy to add more controllable variables. It is however getting a bit cluttered and other options should be evaluated. Building a custom interface is also an option.

Pako: Only used for data compression to reduce save file sizes. Size reduction can be 2-4 times depending on the state of the simulation. Not essential. Downside is that it takes longer to save and load files.
  
# How to run it locally and modify code
  1. Install VS code: https://code.visualstudio.com/
  2. Install VS Code extensions:
   * Live Server
   * GLSL lint
   * Clang-Format, requires installing CLANG/LLVM: https://github.com/llvm/llvm-project/releases/tag/llvmorg-16.0.0
  
  3. Clone project using GIT, or just download ZIP
  4. Open project folder in VS Code
  5. Start live server
  6. Automatically opens in browser
