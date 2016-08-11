/**
 * Created by apesant on 04/04/16.
 */
(function (){
    if(!window.OO || !OO.Pulse){
        throw new Error("The Pulse SDK is not included in the page. Be sure to load it before the JW7 Plugin.");
    }
    /**
     * @typedef SessionSettings
     * @type {Object}
     * @memberof OO.Pulse.JW7Plugin
     * @property {string} category <p>Content category is used by Ooyala Pulse to target ads and determine
     * the ad insertion policy. The content category is represented by either its unique id or one
     * of its aliases set in Ooyala Pulse.</p>
     * @property {OO.adrequest.AdRequester.ContentForm} contentForm Content form is used to determine the ad insertion policy.
     * @property {string} id Ooyala Pulse content id. Id is used to identify the content to 3rd parties.
     * @property {string} contentPartner <p>Ooyala Pulse content partner. Content partners can be used by
     * Ooyala Pulse to target ads. The content partner is represented by either its unique id or one of its
     * aliases set in Ooyala Pulse.</p>
     * @property {number} duration The duration of the content selected by the viewer. This value cannot be negative.
     * @property {string[]} flags Ooyala Pulse flags. Because flags override Ooyala Pulse's ad insertion policy, they
     * should be used with caution. For more information talk to your contact at Ooyala. Supported flags:
     * nocom, noprerolls, nomidrolls, nopostrolls, nooverlays, noskins.
     * @property {string[]} tags  Ooyala Pulse content tags, used to target specific ads.
     * @property {object} customParameters The custom parameters to add to the
     * session request. Parameters with names containing invalid characters are omitted.
     * These custom parameters are added to the ad server request URL in the style
     * of "cp.[parameter_name]=[parameter_value]".
     * @property {number} height Height in pixels of the video area where ads should be shown.
     * @property {number} maxBitRate The maximum bitrate of the media files in the ad response.
     * @property {number} maxLinearBreakDuration The maximum duration in seconds of linear ad breaks.
     * @property {number[]} linearPlaybackPositions An array of numbers which define at what points in time linear ads should be shown.
     * @property {number[]} nonlinearPlaybackPositions An array of numbers which define at what points in time non-linear ads should be shown.
     * @property {OO.adrequest.AdRequester.InsertionPointType} insertionPointFilter If not set,
     * the request is for every kind of insertion point. If set, only the types provided are requested.
     * See [link](http://pulse-sdks.ooyala.com/html5_2/latest/videoplaza.adrequest.AdRequester.html#toc5__anchor) for possible values.
     * @property {number} width Width in pixels of the video area where ads should be shown.
     * @property {string} referrerUrl Overrides the HTTP header's referrer property.
     * @property {number} linearSlotSize Overrides the number of linear ads per slot.
     * <p><strong>NOTE!</strong> Using this affects the predictability of the Ooyala Pulse forecast functionality. Use with caution.</p>
     */

    /**
     * Ooyala Pulse plugin for JW7
     * @param jwPlayer the JW7 player instance
     * @param pulseHostSettings the Pulse host settings : host URL, persistent ID and device container
     * @param onAdClickedCallback <p>called when an ad is clicked. If null the Plugin automatically opens
     * the clickthrough URL and tracks the clickThrough event. The  clickthrough URL is passed as parameter
     * in the method (see the [main README](https://github.com/ooyala/pulse-sdk-html5-2.x-plugin-jw7) file for an example)</p>
     * @constructor
     */
    OO.Pulse.JW7Plugin = function(jwPlayer, pulseHostSettings, onAdClickedCallback) {
        /**
         * the JW player instance
         */
        this.player = jwPlayer;
        /**
         * The Ooyala Pulse ad player controller
         * @type {OO.Pulse.AdPlayerController}
         */
        this.adPlayer = null;

        var adPlayerContainer = getAdPlayerContainer(jwPlayer);
        var session = null;
        var adClickedCallback = onAdClickedCallback;
        var inLinearAdMode = false;
        var playbackStateSave = {};
        var contentFinished = false;
        var beforeContentStart = true;
        var sharedElement = null;
        var jwMediaElement = jwPlayer.getContainer().getElementsByClassName("jw-media")[0];
        var isIOS = false;
        var adVolume = 1;//100%
        var currentPlaylistItem = null;
        var jwPluginDiv = null;
        var adState = "prerolls";
        var pauseAdTimeout = null;
        var contentMetadata = null;
        var requestSettings = null;

        //Play event handler
        var play = function () {
            if (inLinearAdMode && !isIOS) {
                pauseJW.call(this);
            } else {
                this.adPlayer.contentStarted();
            }
        }.bind(this);

        //beforePlay event handler
        var beforePlay = function () {

            if (beforeContentStart) {
                beforeContentStart = false;
                //Load the shared element video now to allow "autoplay" on mobile
                if(sharedElement){
                    sharedElement.load();
                }

                //Create the session now
                initSession.call(this, contentMetadata,
                    requestSettings);

                this.adPlayer.startSession(session, adPlayerListener);
            }
        }.bind(this);

        //time event handler
        var time = function (event) {
            if (!inLinearAdMode) {
                this.adPlayer.contentPositionChanged(event.position);
            }
        }.bind(this);


        //beforeComplete event handler
        var beforeComplete = function () {
            if (!inLinearAdMode) {
                adState = "postrolls";
                this.player.detachMedia();
                this.adPlayer.contentFinished();

            }
        }.bind(this);

        //resize event handler
        var resize = function () {
            this.adPlayer.resize(OO.Pulse.AdPlayer.Settings.SCALING.AUTO,
                OO.Pulse.AdPlayer.Settings.SCALING.AUTO,
                this.player.getFullscreen());
        }.bind(this);

        //fullscreen event handler
        var fullscreen = function () {
            this.adPlayer.resize(OO.Pulse.AdPlayer.Settings.SCALING.AUTO, OO.Pulse.AdPlayer.Settings.SCALING.AUTO, this.player.getFullscreen());
            adPlayerContainer.style.zIndex = "1000000";
        }.bind(this);

        //playlistItem event handler
        var playlistItem = function (event) {
            currentPlaylistItem = event.item.file;
            contentFinished = false;
            adState = "prerolls";
            beforeContentStart = true;
        }.bind(this);

        //mute event handler
        var mute = function (event) {
            if(event.mute){
                //Save the current volume
                adVolume = this.player.getVolume()/100;
                //Set the ad player volume to 0
                this.adPlayer.setVolume(0);
            } else {
                this.adPlayer.setVolume(adVolume);
            }
        }.bind(this);


        //volume event handler
        var volume = function(event){
            this.adPlayer.setVolume(event.volume/100);
        }.bind(this);

        // Pause handler
        var onPause = function(event) {
            if (!inLinearAdMode) {
                pauseAdTimeout = setTimeout((function() {
                    this.adPlayer.contentPaused();
                    pauseAdTimeout = null;
                }).bind(this), 100);
            }
        }.bind(this);

        // Seek handler
        var onSeek = function(event) {
            if (!inLinearAdMode) {
                if(pauseAdTimeout) {
                    clearTimeout(pauseAdTimeout);
                }
            }
        }.bind(this);

        //Ad player listener
        adPlayerListener = {
            startContentPlayback: function () {
                exitLinearAdMode.call(this);
            }.bind(this),
            pauseContentPlayback: function () {
                enterLinearAdMode.call(this);
            }.bind(this),
            illegalOperationOccurred: function (msg) {

            }.bind(this),
            openClickThrough: function (url) {
                openAndTrackClickThrough.call(this, url);
            }.bind(this),
            sessionEnded: function () {
                contentFinished = true;
                if(inLinearAdMode){
                    exitLinearAdMode.call(this);
                } else {
                    //just re attach the media
                    this.player.attachMedia();
                }
                session = null;
            }.bind(this)
        };

        //Set the global Pulse settings
        OO.Pulse.setPulseHost(pulseHostSettings.pulseHost,
            pulseHostSettings.deviceContainer,
            pulseHostSettings.persistentId);

        initAdPlayer.call(this);
        registerEventListeners.call(this);

        //Set the event listeners on the content player
        function registerEventListeners(){
            //Set up the initial play listener
            this.player.on("play", play);
            //Set up the before play listener used for prerolls
            this.player.on("beforePlay", beforePlay);
            //Content position changed
            this.player.on('time', time);
            //Postrolls
            this.player.on("beforeComplete",beforeComplete );
            //Resize the ad player when needed
            this.player.on("resize", resize);
            //Tell the ad player when JW goes fullscreen
            this.player.on("fullscreen", fullscreen);
            //Reset states when a new item is loaded
            this.player.on("playlistItem", playlistItem);
            //Mute the ads if the player goes mute
            this.player.on("mute", mute);
            // Align the ad player volume with the main content
            this.player.on("volume", volume);
            // On pause, try to show pause ads
            this.player.on("pause", onPause);
            this.player.on("seek", onSeek);
        }

        //Remove the event listeners on the content player (used in destroy).
        function unregisterEventListeners(){
            //Set up the initial play listener
            this.player.off("play", play);
            //Set up the before play listener used for prerolls
            this.player.off("beforePlay", beforePlay);
            //Cofftent positioff changed
            this.player.off('time', time);
            //Postrolls
            this.player.off("beforeComplete",beforeComplete );
            //Resize the ad player when needed
            this.player.off("resize", resize);
            //Tell the ad player when JW goes fullscreen
            this.player.off("fullscreen", fullscreen);
            //Reset states when a new item is loaded
            this.player.off("playlistItem", playlistItem);
            //Mute the ads if the player goes mute
            this.player.off("mute", mute);
            // Align the ad player volume with the main cofftent
            this.player.off("volume", volume);
            // Pause handler
            this.player.off("pause", onPause);
            this.player.off("seek", onSeek);
        }

        /**
         * Get the JW player HTML video element
         * @param player
         * @returns {*}
         */
        function getJWVideoElement(player) {
            return player.getContainer().getElementsByClassName("jw-video")[0];
        }

        /**
         * Init the ad player
         */
        function initAdPlayer() {
            isIOS = iOS();
            sharedElement = getJWVideoElement(this.player);

            if (isIOS) {
                this.adPlayer = createAdPlayer(adPlayerContainer, sharedElement);
            } else {
                this.adPlayer = createAdPlayer(adPlayerContainer, null);
            }

            //Set pointer events to none on the ad player div
            if (isIOS) {
                this.adPlayer.getSkinElement().parentElement.style.setProperty("pointer-events", "none", "important");
            }

            this.adPlayer.addEventListener(OO.Pulse.AdPlayer.Events.AD_CLICKED, function (event, eventData) {

                if(adClickedCallback){
                    adClickedCallback(eventData);
                } else {
                    //Default clickthrough behaviour
                    this.adPlayer.pause();
                    openAndTrackClickThrough.call(this, eventData.url);
                }

            }.bind(this));
        }

        /**
         * Init the Pulse session
         * @param contentMetadata content metadata
         * @param requestSettings request settings
         */
        function initSession(contentMetadata, requestSettings) {
            session = OO.Pulse.createSession(contentMetadata, requestSettings);
        }

        /**
         * Default clickthrough handler
         * @param url
         */
        function openAndTrackClickThrough(url) {
            window.open(url);
            this.adPlayer.adClickThroughOpened();
        }

        /**
         * Enter linear ad mode: pause the content, detach the media element on iOS
         */
        function enterLinearAdMode() {

            inLinearAdMode = true;
            playbackStateSave.controls = this.player.getControls();
            pauseJW.call(this);
            this.player.detachMedia();
            this.player.setControls(false);
            if (isIOS) {
                jwPlayer.getContainer().className = jwPlayer.getContainer().className.replace( /(?:^|\s)jw-state-idle(?!\S)/ , '' );
                jwPluginDiv = jwPlayer.getContainer().getElementsByClassName("jw-plugin")[0]
                playbackStateSave.src = sharedElement.src;
                playbackStateSave.currentTime = sharedElement.currentTime;
                jwMediaElement.style.setProperty("pointer-events", "none", "important");
                sharedElement.style.pointerEvents = "all";
            }
        }

        /**
         * Exit linear mode : restore the previous state, restart the content
         */
        function exitLinearAdMode() {

            if(adState !== "postrolls"){
                adState = "midrolls";
            }

            if (inLinearAdMode) {
                this.player.setControls(playbackStateSave.controls);

                if (isIOS) {
                    sharedElement.style.display = "";
                    sharedElement.src = currentPlaylistItem;
                    if(adState === "midrolls") {
                        sharedElement.currentTime = playbackStateSave.currentTime;
                    }
                    this.player.attachMedia();
                    if(adState === "midrolls"){
                        this.player.seek(playbackStateSave.currentTime);
                    }
                } else {
                    this.player.attachMedia();
                }

                if (!contentFinished) {
                    this.adPlayer.contentStarted();
                    this.player.play(true);
                } else {
                    if (isIOS) {
                        jwMediaElement.style.pointerEvents = "";
                        jwPluginDiv.style.pointerEvents = "";
                        sharedElement.style.pointerEvents = "";
                        this.player.attachMedia();
                    }
                }
                inLinearAdMode = false;
            }
        }

        /**
         * Pause JW7
         */
        function pauseJW() {
            if (this.player.getState() !== "paused") {
                this.player.pause(true);
            }
        }

        /**
         * Create the ad player
         * @param container
         * @param sharedElement
         * @returns {*}
         */
        function createAdPlayer(container, sharedElement) {
            return OO.Pulse.createAdPlayer(container, null, sharedElement);
        }

        /**
         * Returns the ad player div in JW7's divs
         * @param player
         * @returns {Element}
         */
        function getAdPlayerContainer(player) {
            var playerContainer = document.getElementById(player.id);
            //We use the overlay div of JW
            var overlays = playerContainer.getElementsByClassName("jw-overlays")[0];
            var container = document.createElement("div");
            container.id = "pulse_" + Math.random();
            overlays.appendChild(container);
            return container;
        }


        /**
         * Detect iOS
         * @returns {boolean}
         */
        function iOS() {
            var iDevices = [
                'iPad Simulator',
                'iPhone Simulator',
                'iPod Simulator',
                'iPad',
                'iPhone',
                'iPod'
            ];

            if (!!navigator.platform) {
                while (iDevices.length) {
                    if (navigator.platform === iDevices.pop()) {
                        return true;
                    }
                }
            }
            return false;
        }

        /**
         * Remove null/undefined properties from an object
         * @param obj
         */
        function cleanObject(obj){
            for (var prop in obj){
                if(obj[prop] === null || obj[prop] === undefined){
                    delete  obj[prop];
                }
            }
        }

        /**
         * Get the content metadata object from the session settings
         * @param sessionSettings
         * @returns {{category: *, contentForm: (*|string), id: *, contentPartner: *, duration: *, flags: *, tags: *, customParameters: *}}
         */
        function getContentMetadataFromSessionSettings(sessionSettings){
            var contentMetadata = {
                category: sessionSettings.category,
                contentForm: sessionSettings.contentForm,
                id: sessionSettings.id,
                contentPartner: sessionSettings.contentPartner,
                duration: sessionSettings.duration,
                flags: sessionSettings.flags,
                tags: sessionSettings.tags,
                customParameters: sessionSettings.customParameters

            };

            //Remove the empty elements from the SDK
            cleanObject(contentMetadata);

            return contentMetadata;
        }

        /**
         * Extract the request settings object needed by the Pulse SDK
         * @param sessionSettings
         * @returns {{height: *, width: *, maxBitRate: *, linearPlaybackPositions: *, nonlinearPlaybackPositions: *, insertionPointFilter: *, referrerUrl: *, linearSlotSize: *}}
         */
        function getRequestSettingsFromSessionSettings(sessionSettings){
            var requestSettings = {
                height: sessionSettings.height,
                width: sessionSettings.width,
                maxBitRate: sessionSettings.maxBitRate,
                linearPlaybackPositions: sessionSettings.linearPlaybackPositions,
                nonlinearPlaybackPositions: sessionSettings.nonlinearPlaybackPositions,
                insertionPointFilter: sessionSettings.insertionPointFilter,
                referrerUrl: sessionSettings.referrerUrl,
                linearSlotSize: sessionSettings.linearSlotSize,
                maxLinearBreakDuration: sessionSettings.maxLinearBreakDuration
            };

            //Remove the empty fields for the SDK
            cleanObject(requestSettings);

            return requestSettings;
        }

        /**
         * Add an event listener to the Pulse ad player to access event data or to add
         * your own logic to the event handling. All ad player events are listed
         * [here](http://pulse-sdks.ooyala.com/pulse-html5/latest/OO.Pulse.AdPlayer.Events.html).
         * @param event event to listen to
         * @param callback callback function
         */
        this.addEventListener = function(event,callback){
            this.adPlayer.addEventListener(event,callback);
        };

        /**
         * Remove an event listener
         * @param event ad player event
         * @param callback callback to remove
         */
        this.removeEventListener = function(event, callback){
            this.adPlayer.removeEventListener(event,callback);
        };

        /**
         * Destroy the plugin and the ad player. Call this method in case the page is also
         * used to display other content where you no longer need the JW7 player and the
         * player is removed from the page.
         */
        this.destroy = function(){
            if(inLinearAdMode){
                exitLinearAdMode();
            }
            //remove the event listeners
            unregisterEventListeners.call(this);
            this.adPlayer.destroy();
        };

        /**
         * Initialize a new session. This is typically done in the `playlistItem` event listener of the JW player.
         * @param {OO.Pulse.JW7Plugin.SessionSettings} sessionSettings
         */
        this.initSession = function(sessionSettings){

            if (sessionSettings.debug) {
                OO.Pulse.debug = sessionSettings.debug;
            }

            //If there was an existing session, stop it
            this.stopSession();

            contentMetadata = getContentMetadataFromSessionSettings(sessionSettings);
            requestSettings = getRequestSettingsFromSessionSettings(sessionSettings);
        };

        /**
         * Extend the existing ad session. This enables ad-hoc ad calls.
         * @param {OO.Pulse.JW7Plugin.SessionSettings} sessionSettings
         * @param onCompleteCallback function called when the session has been extended
         */
        this.extendSession = function (sessionSettings, onCompleteCallback) {
            if (session) {
                session.extendSession(
                    getContentMetadataFromSessionSettings(sessionSettings),
                    getRequestSettingsFromSessionSettings(sessionSettings), onCompleteCallback);
            } else {
                OO.Pulse.Utils.log("Can't extend session. No session object available.")
            }
        }

        /**
         * Stop the ad session. No more ads will be displayed in the video.
         */
        this.stopSession = function () {
            if(session){
                try{
                    this.adPlayer.stopSession();
                } catch (e){

                }
                session = null;
            }
        };

        /**
         * Know if the ad player is currently in a linear ad break
         * @returns {boolean}
         */
        this.isInLinearAdMode = function () {
            return inLinearAdMode;
        };
    }
}());
