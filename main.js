'use strict';

/*
 * Created with @iobroker/create-adapter v1.25.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

const net = require('net');
const serialport = require('serialport');
const Readline = require('@serialport/parser-readline')
const ByteLength = require('@serialport/parser-byte-length');
const TIMEOUT = 5000;
// Load your modules here, e.g.:
// const fs = require("fs");
const MODE_NONE = 0x00;
const MODE_SERIAL = 0x01;
const MODE_NETWORK = 0x02;

const CMDPING = '/*Type;';
const CMDWAITQUEUE_1000 = 1000;
let mode = MODE_NONE;
let parentThis;


let matrix = null;
let bConnection = false;
let bWaitQueue = false;
let bHasIncomingData = false;
let bFirstPing = true;
let iMissedPingCounter = 0;
let arrCMD = [];
let cmdInterval;
let sSerialPortName;
let pingInterval;


//-------
let query = null;
let in_msg = '';
//let iMaxTryCounter = 0;
//let iMaxTimeoutCounter = 0;
//var lastCMD;

let arrStateQuery_Routing = [];
let bQueryComplete_Routing;

let bWaitingForResponse = false;
let bQueryDone;
let bQueryInProgress;
let arrQuery = [];


function toHexString(byteArray) {
	return Array.from(byteArray, function (byte) {
		return ('0' + (byte & 0xff).toString(16)).slice(-2);
	}).join('');
}

class BtouchVideomatrix extends utils.Adapter {

	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: 'btouch_videomatrix',
		});
		this.on('ready', this.onReady.bind(this));
		this.on('objectChange', this.onObjectChange.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		// this.on('message', this.onMessage.bind(this));
		this.on('unload', this.onUnload.bind(this));

		parentThis = this;
	}



	//----Call fron onReady. Creating everything that can later be changed via GUI
	async createStates() {
		//this._createState_Routing();
		//this._createState_ExclusiveRouting();
		//this._createState_Labels();
		//this._createState_Save();
	}


	initMatrix() {
		this.log.info('initMatrix().');

		arrCMD = [];
		mode = MODE_NONE;
		bWaitingForResponse = false;
		bConnection = false;
		bWaitQueue = false;
		bHasIncomingData = false;
		bFirstPing = true;
		iMissedPingCounter = 0;


		//----CMD-Queue einrichten   
		clearInterval(cmdInterval);
		cmdInterval = setInterval(function () {
			parentThis.processCMD();
		}, 100);

		this.connectMatrix();
	}

	disconnectMatrix() {
		if (mode == MODE_SERIAL) {
			this.log.info('disConnectMatrix() Serial');
			if (matrix.isOpen) {
				matrix.close();
				matrix.destroy();
			}
		} else if (mode == MODE_NETWORK) {
			this.log.info('disConnectMatrix() Network');
		}
		matrix.destroy();
	}

	connectMatrix(cb) {
		this.log.info('connectMatrix()');
		let parser;
		arrCMD = [];

		if (this.mode == MODE_SERIAL) {
			this.log.info('connectMatrix(): Serial Port Mode ' + this.sSerialPortName);
			const options = {
				baudRate: 9600,
				dataBits: 8,
				stopBits: 1,
				parity: 'none'
			};

			matrix = new serialport(this.sSerialPortName, options);
			//parser = matrix.pipe(new ByteLength({ length: 1 }));
			parser = matrix.pipe(new Readline({ delimiter: '\r\n' }))
			if (pingInterval) {
				clearInterval(pingInterval);
			}


			/*
			if (bConnection == false) {
				parentThis.log.debug('connectMatrix() Serial. bConnection==false, sending CMDPING:' + CMDPING);
				arrCMD.push(cmdConnect);
				arrCMD.push(cmdWaitQueue_1000);
			} else {
				parentThis.log.debug('_connect() Serial. bConnection==true. Nichts tun');
			}
			*/

			//----Alle x Sekunden ein PING
			pingInterval = setInterval(function () {
				parentThis.pingMatrix();
			}, 2000);

		} else if (this.mode == MODE_NETWORK) {
			this.log.info('connectMatrix():' + this.config.host + ':' + this.config.port);
			matrix = new net.Socket();
			/*
			matrix.connect(this.config.port, this.config.host, function () {
				if (bConnection == false) {
					parentThis.log.debug('connectMatrix() Network. bConnection==false, sending CMDCONNECT:' + toHexString(cmdConnect));
					arrCMD.push(cmdConnect);
					arrCMD.push(cmdWaitQueue_1000);
				} else {
					parentThis.log.debug('_connect() Network. bConnection==true. Nichts tun');
				}
				if (pingInterval) {
					clearInterval(pingInterval);
				}

				//----Alle 0,75 Sekunden ein PING
				pingInterval = setInterval(function () {
					parentThis.pingMatrix();
				}, 750);
			});
			*/
		}


		matrix.on('data', function (chunk) {
			parentThis.log.info('matrix.onData():' + chunk + ' ' + toHexString(chunk));
			if (mode == MODE_SERIAL) {
				parentThis.processIncoming(chunk);
			} else if (mode == MODE_NETWORK) {
				parentThis.processIncoming(chunk);
			}
			//
			//parentThis.log.info('matrix.onData(): ' + parentThis.toHexString(chunk) );

		});

		matrix.on('timeout', function (e) {
			//if (e.code == 'ENOTFOUND' || e.code == 'ECONNREFUSED' || e.code == 'ETIMEDOUT') {
			//            matrix.destroy();
			//}
			parentThis.log.error('AudioMatrix TIMEOUT. TBD');
			//parentThis.connection=false;
			//parentThis.setConnState(false, true);
			//            parentThis.reconnect();
		});

		matrix.on('error', function (e) {
			if (e.code == 'ENOTFOUND' || e.code == 'ECONNREFUSED' || e.code == 'ETIMEDOUT') {
				//matrix.destroy();
				//parentThis.initMatrix();
				if (e.code == 'ECONNREFUSED') {
					parentThis.log.error('Keine Verbindung. Ist der Adapter online?');
					arrCMD.push(cmdWaitQueue_1000);

				}
			}
			parentThis.log.error(e);
			//            parentThis.reconnect();
		});

		matrix.on('close', function (e) {
			//if (bConnection) {
			parentThis.log.error('AudioMatrix closed. TBD');
			//}
			//parentThis.reconnect();
		});

		matrix.on('disconnect', function (e) {
			parentThis.log.error('AudioMatrix disconnected. TBD');
			//            parentThis.reconnect();
		});

		matrix.on('end', function (e) {
			parentThis.log.error('AudioMatrix ended');
			//parentThis.setState('info.connection', false, true);
		});


		parser.on('data', function (chunk) {
			parentThis.log.info('parser.onData()');
			//parentThis.log.info('matrix.onData(): ' + parentThis.toHexString(chunk) );
			if (mode == MODE_SERIAL) {
				parentThis.processIncoming(chunk);
			}
			//parentThis.processIncoming(chunk);
		});
	}

	pingMatrix() {
		if (this.mode == MODE_SERIAL) {
			if (bWaitQueue == false) {
				if (arrCMD.length == 0) {
					this.log.debug('pingMatrix() seriell');
					arrCMD.push(CMDPING);
					iMissedPingCounter = 0;
				}
			}
		} else if (this.mode == MODE_NETWORK) {
			if ((bConnection == true)/*&&(bWaitingForResponse==false)*/ && (bWaitQueue == false)) {
				if (arrCMD.length == 0) {
					this.log.debug('pingMatrix() Network');
					arrCMD.push(CMDPING);
					iMissedPingCounter = 0;
					if (bFirstPing) {
						//----Ab jetzt nicht mehr
						bFirstPing = false;
					}
				}
			} else {
				//----No Connection
				//this.log.info('pingMatrix(): No Connection.');
				iMissedPingCounter++;

				if (iMissedPingCounter > 10) {	//7,5 seconds
					this.log.info('pingMatrix(): 10 mal No Connection. Forciere Reconnect');
					parentThis.disconnectMatrix();
					parentThis.initMatrix();
				}

			}
		}
	}

	// Verarbeitung eingehender Daten
	processIncoming(chunk) {
		//parentThis.log.info('processIncoming(): ' + toHexString(chunk));
		in_msg += chunk;
		bHasIncomingData = true; // IrgendETWAS ist angekommen

		if (bWaitingForResponse == true) {
			if (in_msg.length >= 15) {
				parentThis.log.info('_processIncoming(); slightly processed:' + in_msg);
				bWaitingForResponse = false;
			}
			/*
			if (in_msg.length >= 20 && in_msg.includes('5aa5')) {
				const iStartPos = in_msg.indexOf('5aa5');
				if (in_msg.toLowerCase().substring(iStartPos + 16, iStartPos + 18) == '0a') {
					const tmpMSG = in_msg.toLowerCase().substring(iStartPos, iStartPos + 20); //Checksum
					in_msg = in_msg.slice(20); //Die ersten 20 Zeichen abschneiden
					//parentThis.log.info('_processIncoming(); filtered:' + tmpMSG);
					parentThis.parseMSG(tmpMSG);
					//bWaitingForResponse = false;
				} else if (in_msg.toLowerCase().substring(iStartPos + 4, iStartPos + 6) == '11') {
					//----5aa511c2c00000c2c00000c2c00000c2c0...
					//----In der Regel als Antwort auf einen PING
					//parentThis.log.debug('LevelMeter incoming');
					bWaitingForResponse = false;
				} else if (in_msg.toLowerCase().substring(iStartPos + 4, iStartPos + 6) == '12') {
					//----5aa512c2c00000c2c00000c...
					//----In der Regel als Antwort auf einen PING
					//parentThis.log.debug('Sprectrum incoming');
					bWaitingForResponse = false;
				} else {
					//----Irgendwie vergniesgnaddelt. Das ist offenbar egal, weil die Daten erneut gesendet werden
					//parentThis.log.info('AudioMatrix: matrix.on data: Fehlerhafte oder inkomplette Daten empfangen:' + in_msg);
				}
			}
			*/
		} else {
			//----Durch die PING-Mechanik kommt hier recht viel an, da muessen wir spaeter drauf schauen.
			//parentThis.log.info('AudioMatrix: matrix.on data(): incomming aber bWaitingForResponse==FALSE; in_msg:' + in_msg);
		}

		if (in_msg.length > 120) {
			//----Just in case
			in_msg = '';
		}
	}

	//wird alle 100ms aufgerufen. Die CMD-Queue wird abgearbeitet und Befehle gehen raus.
	processCMD() {
		//this.log.debug('processCMD()');
		if (bWaitQueue == false) {
			if (bWaitingForResponse == false) {
				if (arrCMD.length > 0) {
					//this.log.debug('processCMD: bWaitingForResponse==FALSE, arrCMD.length=' + arrCMD.length.toString());
					bWaitingForResponse = true;

					const tmp = arrCMD.shift();
					this.log.debug('processCMD: next CMD=' + tmp);
					matrix.write(tmp);
					matrix.write('\n');
					bHasIncomingData = false;

					if (query) {
						clearTimeout(query);
					}
					query = setTimeout(function () {
						//----5 Sekunden keine Antwort und das Teil ist offline
						if (bHasIncomingData == false) {
							//----Nach x Milisekunden ist noch gar nichts angekommen....
							parentThis.log.error('processCMD(): KEINE EINKOMMENDEN DATEN NACH ' + TIMEOUT.toString() + ' Milisekunden. OFFLINE?');
							bConnection = false;
							parentThis.disconnectMatrix();
							parentThis.initMatrix();
						} else {
							parentThis.log.info('processCMD(): Irgendetwas kam an... es lebt.');
						}
					}, TIMEOUT);


					/*
					if (tmp.length == 10) {
						//----Normaler Befehl
						//this.log.debug('processCMD: next CMD=' + toHexString(tmp) + ' arrCMD.length rest=' + arrCMD.length.toString());
						matrix.write(tmp);
						bHasIncomingData = false;
						//lastCMD = tmp;
						//iMaxTryCounter = MAXTRIES;
						if (query) {
							clearTimeout(query);
						}
						query = setTimeout(function () {
							//----5 Sekunden keine Antwort und das Teil ist offline
							if (bHasIncomingData == false) {
								//----Nach x Milisekunden ist noch gar nichts angekommen....
								parentThis.log.error('processCMD(): KEINE EINKOMMENDEN DATEN NACH ' + TIMEOUT.toString() + ' Milisekunden. OFFLINE?');
								bConnection = false;
								parentThis.disconnectMatrix();
								parentThis.initMatrix();
							} else {
								parentThis.log.info('processCMD(): Irgendetwas kam an... es lebt.');
							}
						}, TIMEOUT);

					} else if (tmp.length == 2) {
						const iWait = tmp[0] * 256 + tmp[1];
						bWaitQueue = true;
						this.log.debug('processCMD.waitQueue: ' + iWait.toString());
						setTimeout(function () { bWaitQueue = false; parentThis.log.info('processCMD.waitQueue DONE'); }, iWait);
					} else {
						//----Nix          
					}
					*/
				} else {
					//this.log.debug('processCMD: bWaitingForResponse==FALSE, arrCMD ist leer. Kein Problem');
				}
			} else {
				//this.log.debug('AudioMatrix: processCMD: bWaitingForResponse==TRUE. Nichts machen');
			}
		} else {
			//this.log.debug('processCMD: bWaitQueue==TRUE, warten');
		}

		//----Anzeige der Quelength auf der Oberflaeche
		//        this.setStateAsync('queuelength', { val: arrCMD.length, ack: true });
		//

	}

	//==============================================================================================================
	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// Initialize your adapter here

		// The adapters config (in the instance object everything under the attribute "native") is accessible via
		//this.log.info('config optHost: ' + this.config.optHost);
		//this.log.info('config optPort: ' + this.config.optPort);
		//this.log.info('config Connection: ' + this.config.optConnection);

		if (this.config.optConnection == 'connSerial') {
			this.sSerialPortName = this.config.serialPort.trim();
			this.mode = MODE_SERIAL;
		} else if (this.config.optConnection == 'connNetwork') {
			this.mode = MODE_NETWORK;
		} else {
			this.mode = MODE_NONE;
		}

		if (this.mode == MODE_SERIAL) {
			this.log.info("Modus Seriell:" + this.sSerialPortName);
		} else if (this.mode == MODE_NETWORK) {
			this.log.info("Modus Netzwerk");
		}

		this.createStates();

		/*
		For every state in the system there has to be also an object of type state
		Here a simple template for a boolean variable named "testVariable"
		Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
		*/
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

		// in this template all states changes inside the adapters namespace are subscribed
		this.subscribeStates('*');

		/*
		setState examples
		you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
		*/
		/*
		// the variable testVariable is set to true as command (ack=false)
		await this.setStateAsync('testVariable', true);
	
		// same thing, but the value is flagged "ack"
		// ack should be always set to true if the value is received from or acknowledged from the target system
		await this.setStateAsync('testVariable', { val: true, ack: true });
	
		// same thing, but the state is deleted after 30s (getState will return null afterwards)
		await this.setStateAsync('testVariable', { val: true, ack: true, expire: 30 });
	
		// examples for the checkPassword/checkGroup functions
		let result = await this.checkPasswordAsync('admin', 'iobroker');
		this.log.info('check user admin pw iobroker: ' + result);
	
		result = await this.checkGroupAsync('admin', 'admin');
		this.log.info('check group user admin group admin: ' + result);
		*/

		this.initMatrix();
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
			this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
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
			this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
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
	// 	if (typeof obj === 'object' && obj.message) {
	// 		if (obj.command === 'send') {
	// 			// e.g. send email or pushover or whatever
	// 			this.log.info('send command');

	// 			// Send response in callback if required
	// 			if (obj.callback) this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
	// 		}
	// 	}
	// }

}

// @ts-ignore parent is a valid property on module
if (module.parent) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new BtouchVideomatrix(options);
} else {
	// otherwise start the instance directly
	new BtouchVideomatrix();
}