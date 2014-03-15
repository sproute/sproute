# Sproute Framework

## Installation Guide

**1. Clone the repo in your project**

Make sure the directory is named `sproute` and exists in your project directory.

For unix-like systems (e.g. OSX, BSD, Linux) you may use the command-line tool. You must link it to your path by running the following:

	cd /path/to/sproute
	./sproute.sh link

**2. Install the dependencies and modules**

- Node v0.10
- MongoDB or Riak

Run the following in a terminal:
	
	cd /path/to/project
	sproute modules

or in Windows run `windows/install.bat`

**3. Create the necessary files**

Inside the project directory:

	D models/
	D views/
	  controller.js
	  config.js
	  permissions.js

or use the command-line tool to generate them:

	cd /path/to/project
	sproute init

**4. Run the server with either**
	
	cd /path/to/project
	sproute serve

or on Windows run `windows/start-server.bat`