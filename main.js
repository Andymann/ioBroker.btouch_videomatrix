'use strict';

/*
 * Created with @iobroker/create-adapter v1.11.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const MAXCHANNELS = 10;

var net = require('net');
var matrix;
var recnt;
var connection = false;
var query = null;
var in_msg = '';
var iMaxTryCounter = 0;
var iMaxTimeoutCounter = 0;
var lastCMD;
var parentThis;
var arrCMD = [];
var arrStateQuery_Routing = [];

var bQueryComplete_Routing;

var cmdPing = '/*Type;';

var bWaitingForResponse = false;
var bQueryDone;
var bQueryInProgress;

var arrQuery = [];


class Videomatrix extends utils.Adapter {

	
	
	/**
	 * @param {Partial<ioBroker.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: 'videomatrix',
		});
		this.on('ready', this.onReady.bind(this));
		this.on('objectChange', this.onObjectChange.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		//this.on("message", this.onMessage.bind(this));
		this.on('unload', this.onUnload.bind(this));

		parentThis = this;
	}


    toHexString(byteArray) {
        return Array.from(byteArray, function(byte) {
            return ('0' + (byte & 0xFF).toString(16)).slice(-2);
        }).join('')
    }

    //----26 chars to one 13-element Array
    toArray(response){
        var chunks = [];
        for (var i = 0, charsLength = response.length; i < charsLength; i += 2) {
            chunks.push(parseInt(response.substring(i, i + 2), 16));
        }
        return chunks;
    }

    initmatrix(){
        //this.log.info('initMatrix().');
	this.connectmatrix();                                                  
    }

    reconnect(){
        this.log.info('VideoMatrix: reconnectMatrix()');
        connection = false;
        clearInterval(query);
        clearTimeout(recnt);
        matrix.destroy();

        this.log.info('VideoMatrix: Reconnect after 15 sec...');
        this.setState('info.connection', false, true);
        recnt = setTimeout(function() {
            parentThis.initmatrix();
        }, 15000);
    }

    pingMatrix(){
        this.log.info('VideoMatrix: pingMatrix()' );
        arrCMD.push(cmdPing);
        iMaxTryCounter = 3;
        this.processCMD();
    }

    //----Fragt die Werte vom Geraet ab.
    queryMatrix(){                
        //this.log.debug('VideoMatrix: queryMatrix(). arrCMD.length vorher=' + arrCMD.length.toString());                      
        bQueryInProgress  = true;
	this.setState('queryState', true, true);
        arrQuery.forEach(function(item, index, array) {                             
            //parentThis.log.info('VideoMatrix: queryMatrix(). pushing:' + item);
            arrCMD.push(item);
        });
        //this.log.debug('VideoMatrix: queryMatrix(). arrCMD.length hinterher=' + arrCMD.length.toString());
        iMaxTryCounter = 3;
        this.processCMD();
    }

    connectmatrix(cb){
        var host = this.config.host;
        var port = this.config.port;

	arrQuery = [];
	for (var i=0; i<MAXCHANNELS; i++) {
		//this.log.info('VideoMatrix: connect(): push to arrQuery:' + 'Status' + (i+1).toString() + '.');
		arrQuery.push("Status" + (i+1).toString() + ".");
	}
        
        bQueryDone = false;
        bQueryInProgress=false;

        bQueryComplete_Routing = false;
        
	arrStateQuery_Routing = [];
	for (var i = 0; i < MAXCHANNELS; i++) {
            arrStateQuery_Routing.push(false);	    
        }
	
	//connection = false;
        //clearInterval(query);
        //clearTimeout(recnt);
        //matrix.destroy();
        
        this.log.info('VideoMatrix: connecting to: ' + this.config.host + ':' + this.config.port);

        matrix = new net.Socket();
        matrix.connect(this.config.port, this.config.host, function() {
	    clearInterval(query);
            query = setInterval(function() {
		    if(connection==false){
			if(bWaitingForResponse==false){
	                        parentThis.log.info('VideoMatrix: connectMatrix().connection==false, sending CMDPING:' + cmdPing);
        	                arrCMD.push(cmdPing);
        	                iMaxTryCounter = 3;
        	                parentThis.processCMD();
			}else{
				parentThis.log.debug('VideoMatrix: connectMatrix().connection==false, bWaitingForResponse==false; nichts machen');
			}
                    }else{
                        if(bQueryDone==true){
                            if(arrCMD.length==0){
	                        parentThis.log.debug('VideoMatrix: connectMatrix().connection==true, bQueryDone==TRUE, idle, pinging Matrix');
        	                parentThis.pingMatrix();                                                                                                          
                            }else{
                                parentThis.log.debug('VideoMatrix: connectMatrix().connection==true, bQueryDone==TRUE, arrCMD.length>0; idle, aber KEIN ping auf Matrix');
                            }
                        }else{
                            if(!bQueryInProgress){
                                parentThis.log.debug('VideoMatrix: connectMatrix().connection==true, bQueryDone==FALSE, idle, query Matrix');                            
                                parentThis.queryMatrix();
                            }else{
				parentThis.log.debug('VideoMatrix: connectMatrix().connection==true, bQueryDone==FALSE, bQueryInProgress==TRUE, idle');      
				parentThis.queryMatrix();                      
			    }
                        }                                                                                           
                    }

                    //----Intervall fuer Befehle, Timeouts, etc
                    setTimeout(function(){
                        //parentThis.log.info('VideoMatrix: connectMatrix(): kleines Timeout');
                        if(bWaitingForResponse==true){
                            if(bQueryInProgress==false){
			            if(iMaxTryCounter>0){
			                //----Es kann passieren, dass man direkt NACH dem Senden eines Befehls an die Matrix und VOR der Antwort hier landet.
			                //----deswegen wird erstmal der MaxTryCounter heruntergesetzt und -sofern nichts kommt- bis zum naechsten Timeout gewartet.
			                //----Wenn iMaxTryCounter==0 ist, koennen wir von einem Problem ausgehen
			                parentThis.log.info('VideoMatrix: connectMatrix(): kleines Timeout. bWaitingForResponse==TRUE iMaxTryCounter==' + iMaxTryCounter.toString() );
			                parentThis.log.info('VideoMatrix: connectMatrix(): kleines Timeout. lastCMD =' + lastCMD + '. MinorProblem = TRUE');
			                iMaxTryCounter--;   
					parentThis.setState('minorProblem', true, true);
			            }else{
			                if(iMaxTimeoutCounter<3){
			                    parentThis.log.info('VideoMatrix: connectMatrix() in_msg: kleines Timeout. bWaitingForResponse==TRUE iMaxTryCounter==0. Erneutes Senden von ' + lastCMD);
			                    iMaxTimeoutCounter++;
			                    iMaxTryCounter=3;
			                    if(lastCMD !== undefined){
			                        setTimeout(function() {
			                            matrix.write(lastCMD + '\n\r');            
			                        }, 100);
			                    }
			                }else{
			                    parentThis.log.error('VideoMatrix: connectMatrix() in_msg: kleines Timeout. bWaitingForResponse==TRUE iMaxTryCounter==0. Erneutes Senden von ' + lastCMD + 'schlug mehrfach fehl');
			                    iMaxTimeoutCounter=0;
			                    parentThis.log.error('VideoMatrix: connectMatrix() in_msg: kleines Timeout. bWaitingForResponse==TRUE iMaxTryCounter==0');
			                    //parentThis.log.error('WIE reagieren wir hier drauf? Was ist, wenn ein Befehl nicht umgesetzt werden konnte?');
			                    bWaitingForResponse=false;
			                    lastCMD = '';
			                    in_msg = '';
			                    arrCMD = [];
			                    parentThis.reconnect();
			                }
			            }
                            }else{
				parentThis.setState('minorProblem', true, true);
				if(connection==true){
                                    parentThis.log.info('VideoMatrix: connectMatrix(): kleines Timeout. bWaitingForResponse==TRUE, bQueryInProgress==TRUE. Abwarten. iMaxTryCounter==' + iMaxTryCounter.toString() );
                                }else{
                                    //----Fuer den Fall, dass der Verbindungsversuch fehlschlaegt
                                    parentThis.log.info('VideoMatrix: connectMatrix(): kleines Timeout. bWaitingForResponse==TRUE, bQueryInProgress==TRUE. Connection==FALSE. iMaxTryCounter==' + iMaxTryCounter.toString() );
				    bWaitingForResponse=false;
                                    iMaxTryCounter--;
                                }
                            }
                        }else{
                            parentThis.log.debug('VideoMatrix: connectMatrix() in_msg: kleines Timeout. bWaitingForResponse==FALSE, kein Problem');
                        }
                    }, 333/*kleinesIntervall*/);

//                }else{
//                    parentThis.log.debug('VideoMatrix: connectMatrix().Im Ping-Intervall aber tabu==TRUE. Nichts machen.');
//                }
            }, 5000);

            if(cb){
                cb();
            }                             
        });

        matrix.on('data', function(chunk) {
            in_msg += chunk;
            //parentThis.log.debug('VideoMatrix: matrix.on data(); in_msg:' + in_msg );
	    if(in_msg.includes('\r')){
		parentThis.log.debug('VideoMatrix: matrix.on data() COMPLETE: in_msg:' + in_msg );
//		in_msg = '';
	    }
	
            if(bWaitingForResponse==true){                                                                          
                if(in_msg.includes('\r')){
                    //parentThis.log.debug('VideoMatrix: matrix.on data(); in_msg ist lang genug und enthaelt f0:' + in_msg);
                    //var iStartPos = in_msg.indexOf('f0');
                    //if(in_msg.toLowerCase().substring(iStartPos+24,iStartPos+26)=='f7'){                                                                                              
                        bWaitingForResponse = false;
			var tmpMSG = in_msg;
                        //var tmpMSG = in_msg.toLowerCase().substring(iStartPos,iStartPos+26);
                        //parentThis.log.debug('VideoMatrix: matrix.on data(); filtered:' + tmpMSG);
                        //parentThis.bWaitingForResponse = false;
                        parentThis.parseMsg(tmpMSG);
                        in_msg = '';
                        lastCMD = '';
                        //iMaxTryCounter = 3;
                        iMaxTimeoutCounter = 0;
                        parentThis.processCMD();                        
                    //}else{
                    //    //----Irgendwie vergniesgnaddelt
                    //    parentThis.log.info('VideoMatrix: matrix.on data: Fehlerhafte oder inkomplette Daten empfangen:' + in_msg);                                                                                                   
                    //}                                                                                           
                }
            }else{
                parentThis.log.debug('VideoMatrix: matrix.on data(): incomming aber bWaitingForResponse==FALSE; in_msg:' + in_msg);
            }

            if(in_msg.length > 23){
                //----Just in case
                in_msg = '';
            }
        });

        matrix.on('timeout', function(e) {
            //if (e.code == "ENOTFOUND" || e.code == "ECONNREFUSED" || e.code == "ETIMEDOUT") {
            //            matrix.destroy();
            //}
            parentThis.log.error('VideoMatrix TIMEOUT');
            //parentThis.connection=false;
            //parentThis.setConnState(false, true);
            parentThis.reconnect();
        });

        matrix.on('error', function(e) {
            if (e.code == "ENOTFOUND" || e.code == "ECONNREFUSED" || e.code == "ETIMEDOUT") {
                matrix.destroy();
            }
            parentThis.log.error(e);
            parentThis.reconnect();
        });

        matrix.on('close', function(e) {
            if(connection){
                parentThis.log.error('VideoMatrix closed');
            }
	    parentThis.log.error('VideoMatrix CLOSE');
            //parentThis.reconnect();
        });

        matrix.on('disconnect', function(e) {
            parentThis.log.error('VideoMatrix disconnected');
            parentThis.reconnect();
        });

        matrix.on('end', function(e) {
            parentThis.log.error('VideoMatrix ended');
            //parentThis.setConnState(false, true);                                            
        });
    }

    //----Befehle an die Hardware werden in einer Queue geparkt und hier verarbeitet.
    processCMD(){
        if(!bWaitingForResponse){
            if(arrCMD.length>0){
                this.log.debug('VideoMatrix: processCMD: bWaitingForResponse==FALSE, arrCMD.length=' +arrCMD.length.toString());
                bWaitingForResponse=true;
                var tmp = arrCMD.shift();
                this.log.debug('VideoMatrix: processCMD: next CMD=' + tmp + ' arrCMD.length rest=' +arrCMD.length.toString());
                lastCMD = tmp;
                setTimeout(function() {
                    matrix.write(tmp + '\n\r');           
                }, 100);
            }else{
                this.log.debug('VideoMatrix: processCMD: bWaitingForResponse==FALSE, arrCMD ist leer. Kein Problem');
            }
        }else{
            this.log.debug('VideoMatrix: processCMD: bWaitingForResponse==TRUE. Nichts machen');
        }

        //----Anzeige der Quelength auf der Oberflaeche
        this.setStateAsync('queuelength', { val: arrCMD.length, ack: true });
    }

    //----stellt fest, ob das Abfragen der Werte vollstaendig ist.
    checkQueryDone(){                     
        //----Routing
        if(bQueryComplete_Routing==false){
            var bTMP_Routing = true;
	    var sRouting = 'Routing:';
            arrStateQuery_Routing.forEach(function(item, index, array) {                		 
                bTMP_Routing = bTMP_Routing && item;
		sRouting += item.toString() + ' ';
            });
            bQueryComplete_Routing = bTMP_Routing;
            this.log.debug('checkQueryDone(): Routing:' + bQueryComplete_Routing);
	    this.log.debug('checkQueryDone(): Routing:' + sRouting);
        }else{
            this.log.debug('checkQueryDone(): Abfrage auf Routing bereits komplett.');
        }
        
        bQueryDone = bQueryComplete_Routing;
	//this.setState('info.connection', bQueryDone, true);

        if(bQueryDone){
            bQueryInProgress=false;
            this.setState('queryState', false, true);
        }
    }

/*
    //----Uebergabe: Nummer statt Index
    setRoutingState(pIN, pOUT){
	//this.setStateAsync('outputroutestate_' + (pOUT).toString(), { val: pIN, ack: true });
	this.setStateAsync('input_' + (pIN).toString().padStart(2, '0') + '_out_' + (pOUT).toString().padStart(2, '0'), { val: true, ack: true });
        arrStateQuery_Routing[stateCheckCounter] = true;
        this.checkQueryDone();
    }
*/
    //----Verarbeitung ankommender Daten. alles ist asynchron.
    parseMsg(msg){
	msg = msg.trim();
	this.log.debug('parseMsg():' + msg );

	if(msg.toLowerCase().includes('odel:')){
	    this.log.info('parseMsg() Response = CONNECTION' );
            connection = true;
            this.setState('info.connection', true, true);
	    this.setState('minorProblem', false, true);

	}else if(msg.toLowerCase().startsWith('/v:')){
	    //----Ein Ergebnis der Query
	    var iStart = msg.indexOf(':')+1;
	    var tmpIN = msg.substring(iStart, msg.indexOf(' '));
	    var tmpOUT = msg.substring(msg.lastIndexOf(' ')+1).trim();	
	    //this.log.info('parseMsg(): Routing Query Answer: IN:' + tmpIN + '; OUT:' + tmpOUT + ';');
	    
	    this.setStateAsync('input_' + (tmpIN).toString().padStart(2, '0') + '_out_' + (tmpOUT).toString().padStart(2, '0'), { val: true, ack: true });
            arrStateQuery_Routing[parseInt(tmpOUT)-1] = true;
            this.checkQueryDone();
	    

	}else if(msg.toLowerCase().startsWith('/')){
	    //----Repsonse auf gesetztes Routing, Obacht bei der Reihenfolge.
	    //----Response z.B. /1V3.
	    var iTrenner = msg.toLowerCase().indexOf('v');
	    var sEingang = msg.substring(1, iTrenner);

	    var sAusgang = msg.substring(iTrenner+1, msg.indexOf('.'));
	    //this.log.info('parseMsg(): SET Routing Answer: IN:' + sEingang + '; OUT:' + sAusgang + ';');

	} else {
            this.log.info('VideoMatrix: parseMsg() Response unhandled:' + msg );
        }


        bWaitingForResponse = false;
    }


    //----Ein State wurde veraendert
    matrixchanged(id, val, ack){

        if (connection && val && !val.ack) {
            //this.log.info('matrixChanged: tabu=TRUE' );
            //tabu = true;
        }
        if(ack==false){            

            if(id.toString().includes('.outputroutestate_')){
                var sAusgang = (id.toLowerCase().substring(id.lastIndexOf('_')+1));
               	var sEingang = val.toString();


                this.log.debug('VideoMatrix: matrixChanged: Eingang ' + sEingang + ' Ausgang ' + sAusgang );
		var cmdRoute = sEingang + 'V' + sAusgang + '.';
                //this.send(cmdRoute, 5);
                arrCMD.push(cmdRoute);
                this.processCMD();

	    }else if(id.toString().includes('.inputroutestate_')){
                var sEingang = (id.toLowerCase().substring(id.lastIndexOf('_')+1));
               	var sAusgang = val.toString();


                this.log.debug('VideoMatrix: matrixChanged: Eingang ' + sEingang + ' Ausgang ' + sAusgang );
		var cmdRoute = sEingang + 'V' + sAusgang + '.';
                //this.send(cmdRoute, 5);
                arrCMD.push(cmdRoute);
                this.processCMD();

            }else if(id.toString().includes('.input_')){
		var sEingang = id.substring(id.indexOf('input_')+6, id.indexOf('_out'));
		var sAusgang = id.substring(id.indexOf('_out_')+5);
		//this.log.info('Neues Routing: IN:' + sEingang + ', OUT:' + sAusgang + '.Wert:' + val.toString() + '.Ende');
		
		//this.log.info('Neues Routing: IN: Ein Ausgang kann nur einen definierten Eingang besitzen');
		for (var i = 0; i < MAXCHANNELS; i++) {
		    if(i+1 != parseInt(sEingang) ){			
			this.log.debug('Neues Routing: IN: Ein Ausgang kann nur einen definierten Eingang besitzen. Setzte Eingang ' + (i+1).toString() + ' fuer Ausgang ' + sAusgang + ' auf FALSE');
			this.setStateAsync('input_' + (i+1).toString().padStart(2, '0') + '_out_' + (sAusgang).toString().padStart(2, '0'), { val: false, ack: true });
		    }
		}

		var cmdRoute;		
		if(val==true){
		    cmdRoute = sEingang + 'V' + sAusgang + '.';	
		    //this.setStateAsync('input_' + (pIN).toString().padStart(2, '0') + '_out_' + (pOUT).toString().padStart(2, '0'), { val: true, ack: true });
		}else{
		    //----Ausschalten
		    cmdRoute = sAusgang + '$.';
		    //this.setStateAsync('input_' + (pIN).toString().padStart(2, '0') + '_out_' + (pOUT).toString().padStart(2, '0'), { val: false, ack: true });
		}
		

		
                arrCMD.push(cmdRoute);
                this.processCMD();

	    }

        }//----ack==FALSE                         

    }

    /**
    * Is called when databases are connected and adapter received configuration.
    */
    async onReady() {
        // Initialize your adapter here

        // Reset the connection indicator during startup
        //this.setState('info.connection_net', false, true);
        //this.setState('info.connection_hardware', false, true);
        this.setState('info.connection', false, true);

        // The adapters config (in the instance object everything under the attribute "native") is accessible via
        // this.config:
        //this.log.info('config option1: ' + this.config.option1);
        //this.log.info('config option2: ' + this.config.option2);
        this.log.info('VideoMatrix: config Host: ' + this.config.host);
        this.log.info('VideoMatrix: config Port: ' + this.config.port);
        

        /*
        For every state in the system there has to be also an object of type state
        Here a simple template for a boolean variable named "testVariable"
        Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
        */
        /*
        await this.setObjectAsync('testVariable', {
        type: 'state',
        common: {
        name: 'testVariable',
        type: 'boolean',
        role: 'indicator',
        read: true,
        write: true,
        },
        native: {},
        });
        */

	

/*        
        //----Routing via Buttons; 0-indiziert, aber Anzeige beginnt bei '1'
        for (var i = 0; i < MAXCHANNELS; i++) {            
		await this.setObjectAsync('outputroutestate_' + (i+1).toString(), {
		    type: 'state',
		    common: {
		        name: 'outputrouting',
		        type: 'number',
		        role: 'level',
		        read: true,
		        write: true,
		    },
		    native: {},
		});
	    
        }

*/
/*
	for (var i = 0; i < MAXCHANNELS; i++) {            
		await this.setObjectAsync('inputroutestate_' + (i+1).toString(), {
		    type: 'state',
		    common: {
		        name: 'Input to Output',
		        type: 'number',
		        role: 'level',
		        read: true,
		        write: true,
		    },
		    native: {},
		});
	    
        }
*/

	for (var i = 0; i < MAXCHANNELS; i++) {            
	    for (var j = 0; j < MAXCHANNELS; j++) {           
		await this.setObjectAsync('input_' + (i+1).toString().padStart(2, '0') + '_out_' + (j+1).toString().padStart(2, '0'), {
		    type: 'state',
		    common: {
		        name: 'Connect Input to Output',
		        type: 'boolean',
			def: 'false',
		        role: 'indicator',
		        read: true,
		        write: true,
		    },
		    native: {},
		});
	    }
        }


        //----Laenge von arrCMD; der Command-Queue
        await this.setObjectAsync('queuelength', {
            type: 'state',
            common: {
                name: 'Length of Command-Queue',
                type: 'number',
                role: 'level',
                read: true,
                write: false
                //min: 1,
                //max: 6
            },
            native: {},
        });

	await this.setObjectAsync('queryState', {
		type: 'state',
		common: {
			name: 'True: Hardware is being queried after Connection. False: Done',
			type: 'boolean',
			role: 'indicator',
			read: true,
			write: false,
		},
		native: {},
        });

	await this.setObjectAsync('minorProblem', {
		type: 'state',
		common: {
			name: 'True: Hardware did not resond instantly. Reconnect will be triggered if happens 3 times in a row.',
			type: 'boolean',
			role: 'indicator',
			read: true,
			write: false,
		},
		native: {},
        });



        // in this template all states changes inside the adapters namespace are subscribed
        this.subscribeStates('*');

        /*
        setState examples
        you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
        */
        // the variable testVariable is set to true as command (ack=false)
        // await this.setStateAsync('testVariable', true);

        // same thing, but the value is flagged "ack"
        // ack should be always set to true if the value is received from or acknowledged from the target system
        // await this.setStateAsync('testVariable', { val: true, ack: true });

        // same thing, but the state is deleted after 30s (getState will return null afterwards)
        // await this.setStateAsync('testVariable', { val: true, ack: true, expire: 30 });

        // examples for the checkPassword/checkGroup functions
        // let result = await this.checkPasswordAsync('admin', 'iobroker');
        // this.log.info('check user admin pw ioboker: ' + result);

        // result = await this.checkGroupAsync('admin', 'admin');
        // this.log.info('check group user admin group admin: ' + result);

        //----
        this.initmatrix();
    }

	

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			this.log.info('cleaned everything up...');
			callback();
		} catch (e) {
			callback();
		}
	}

	/**
	 * Is called if a subscribed object changes
	 * @param {string} id
	 * @param {ioBroker.Object | null | undefined} obj
	 */
	onObjectChange(id, obj) {
		if (obj) {
			// The object was changed
			this.log.debug(`object ${id} changed: ${JSON.stringify(obj)}`);			
		} else {
			// The object was deleted
			this.log.info(`object ${id} deleted`);
		}
	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	onStateChange(id, state) {
		if (state) {
			// The state was changed
			//state videomatrix.0.testVariable changed: 
			this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
			this.matrixchanged(id, state.val, state.ack);

		} else {
			// The state was deleted
			this.log.info(`state ${id} deleted`);
		}
	}

	// /**
	//  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
	//  * Using this method requires "common.message" property to be set to true in io-package.json
	//  * @param {ioBroker.Message} obj
	//  */
	// onMessage(obj) {
	// 	if (typeof obj === "object" && obj.message) {
	// 		if (obj.command === "send") {
	// 			// e.g. send email or pushover or whatever
	// 			this.log.info("send command");

	// 			// Send response in callback if required
	// 			if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
	// 		}
	// 	}
	// }

}

if (module.parent) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<ioBroker.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new Videomatrix(options);
} else {
	// otherwise start the instance directly
	new Videomatrix();
}
