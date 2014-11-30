# backpack.tf automatic #

*Read this carefully before doing anything, it contains a full set of instructions. Read past the download links before asking for help.*

### What is this for? What does it do? ###

* Automatically accept incoming offers that match your listings on [backpack.tf](http://backpack.tf).
* Supports multiple listings in a single offer.
* Automatically rejects any incoming offer from a banned user or tagged scammer.
* Please note that at this moment, it only supports TF2 offers.
* The bot will handle change as part of the trade offer in metal only. If you're asking for 1 key, it will not accept anything else than 1 key. If you're asking 8.33 refined for an item and the buyer offers 9 refined while asking the item + 2 reclaimed metal back, it will process the offer normally.
* 'Ghost' trade offers, where items are unavailable, are automatically declined. Normally it's not possible to decline them manually.
* Every 5 minutes an heartbeat is dispatched to the backpack.tf server. This allows us to identify which users are currently running the bot and switching the trade offer button to an automatic trade offer button.

### How do I get set up? ###

#### For the lazy - Windows only ####
* Install [Node.js](http://nodejs.org)
    * Windows 64-bit: http://nodejs.org/dist/v0.10.33/node-v0.10.33-x64.msi
    * Windows 32-bit: http://nodejs.org/dist/v0.10.33/node-v0.10.33-x86.msi
* Install [OpenSSL](http://slproweb.com/products/Win32OpenSSL.html) (Install the FULL version - links below). Ensure you allow the files to go in your system folder when prompted.
    * Windows 64-bit: http://slproweb.com/download/Win64OpenSSL-1_0_1j.exe
    * Windows 32-bit: http://slproweb.com/download/Win32OpenSSL-1_0_1j.exe
* You might also need to install Visual C++ 2008 Redistributable. Only do so if you run into issues.
    * Windows 64-bit: http://www.microsoft.com/en-us/download/details.aspx?id=15336
    * Windows 32-bit: http://www.microsoft.com/en-us/download/details.aspx?id=29
* [Download](https://bitbucket.org/srabouin/backpack.tf-automatic/downloads) the pre-packaged version (backpack.tf-automatic-x.x.x-win.zip) and *unpack it to a folder of your choice*, it will not work if you do not unpack it.
    * Windows 64-bit: https://bitbucket.org/srabouin/backpack.tf-automatic/downloads/backpack.tf-automatic-0.0.20-win-x64.zip
    * Windows 32-bit: https://bitbucket.org/srabouin/backpack.tf-automatic/downloads/backpack.tf-automatic-0.0.20-win-x86.zip
* Double-click automatic.bat.
* If you get an error and you've completed everything above, please try to restart your computer. Sometimes a reboot is necessary for node to function properly on certain systems.
* Fill in the details. See the `Running the application` section below.

#### Power Users ####
* Install [Node.js](http://nodejs.org)
> Windows users, please see the additional requirements for [ursa](https://github.com/Medium/ursa#testing).
* [Download](https://bitbucket.org/srabouin/backpack.tf-automatic/downloads) the package or clone the repository to a folder of your choice.
* From the command line, issue `npm install` from the folder you have unpacked / cloned the repository to install all the required modules. This may take several minutes to run.
* Type `node bot`
> Windows users, please ensure you are running the command prompt as an administrator when performing the installation.
* Optionally, if you don't want to be bothered with crashes, you can use `forever` or a similar package. On the command line, install it with `npm install -g forever`. Then you can use it as a node replacement like such: `forever bot.js`. Don't forget `.js`, it is mandatory with forever.

### Running the application ###

* The bot will ask you for your Steam details and your backpack.tf token. You can find your token on your [Settings](http://backpack.tf/settings) page, in the "Advanced" section.
* You can get your Steam Guard code from your email (only valid once). If you have family view enabled, you will also have to give your PIN.
* *Your password will be hidden during setup, it will still accept keystrokes. Use enter to submit as usual.*
* Place the items you are selling at the beginning of your backpack so they are easier to find, especially if you have multiple identical items and only selling one. backpack.tf relies on the item id, so if the person sending you a trade offer picks the wrong item, the offer will not be automatically accepted as it will not be able to match your item. By placing it at the beginning of your backpack and then creating a listing for your item, you will ensure the proper item is easily accessible.

### I get a specific error when I start the bot, what does it mean? ###
#### Error: The specified module could not be found. Something about ursaNative.bin ####
If you are running Windows, you probably didn't follow the steps above. Make sure you have installed OpenSSL (see links below). Install the full version, not the light. You might also need the Visual C++ 2008 Redistributables package from the same page, it will let you know if you need it when you try to install OpenSSL.

#### 'node' is not recognized as an internal or external command, operable program or batch file ####
Restart your computer.

### Who do I talk to if I run into problems, want to report a bug, or want to suggest features? ###

* Please use the [issues](https://bitbucket.org/srabouin/backpack.tf-automatic/issues?status=new&status=open) section of this repo.
* Ask the community for help on the [backpack.tf forums](http://forums.backpack.tf/index.php?/topic/20204-backpacktf-automatic-help-thread/). However, report bugs on the issue tracker (see above).