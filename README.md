# backpack.tf automatic #

### What is this for? What does it do? ###

* Automatically accept incoming offers that match your listings on [backpack.tf](http://backpack.tf).
* Supports multiple listings in a single offer.
* Automatically rejects any incoming offer from a banned user or tagged scammer.
* Please note that at this moment, it only supports TF2 offers.
* The bot will handle change as part of the trade offer in metal only. If you're asking for 1 key, it will not accept anything else than 1 key. If you're asking 8.33 refined for an item and the buyer offers 9 refined while asking the item + 2 reclaimed metal back, it will process the offer normally.
* Every 5 minutes an heartbeat is dispatched to the backpack.tf server. This allows us to identify which users are currently running the bot and switching the trade offer button to an automatic trade offer button.

### How do I get set up? ###

#### Power Users ####
* Install [Node.js](http://nodejs.org)
> Windows users, please see the additional requirements for [ursa](https://github.com/Medium/ursa#testing).
* [Download](https://bitbucket.org/srabouin/backpack.tf-automatic/downloads) the package or clone the repository to a folder of your choice.
* From the command line, issue *npm install* from the folder you have unpacked / cloned the repository to install all the required modules. This may take several minutes to run.
> Windows users, please ensure you are running the command prompt as an administrator.

#### For the lazy ####
* Install [Node.js](http://nodejs.org)
* Install [OpenSSL](http://slproweb.com/products/Win32OpenSSL.html)
* [Download](https://bitbucket.org/srabouin/backpack.tf-automatic/downloads) the pre-packaged version (backpack.tf-automatic-x.x.x-win.zip) and unpack it to a folder of your choice
* Double-click automatic.bat.

### Running the application ###

* Type *node bot.js*.
* The bot will ask you for your Steam details and your backpack.tf token. You can find your token on your [Settings](http://backpack.tf/settings) page.

### Recommended usage ###

* Place the items you are selling at the beginning of your backpack so they are easier to find, especially if you have multiple identical items and only selling one. backpack.tf relies on the item id, so if the person sending you a trade offer picks the wrong item, the offer will not be automatically accepted as it will not be able to match your item. By placing it at the beginning of your backpack and then creating a listing for your item, you will ensure the proper item is easily accessible.

### Who do I talk to if I run into problems or want to report a bug? ###

* Please use the [issues](https://bitbucket.org/srabouin/backpack.tf-automatic/issues?status=new&status=open) section of this repo.

### I get a specific error when I start the bot, what does it mean? ###
#### Error: The specified module could not be found. Something about ursaNative.bin ####
If you are running Windows, you probably didn't follow the steps above. Make sure you have installed [OpenSSL](http://slproweb.com/products/Win32OpenSSL.html). Install the full version, not the light. (Look for Win64 OpenSSL v1.0.1i) You might also need the Visual C++ 2008 Redistributables package from the same page, it will let you know if you need it when you try to install OpenSSL.