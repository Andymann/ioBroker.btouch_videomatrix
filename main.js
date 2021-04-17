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

const MODE_NONE = 0x00;
const MODE_SERIAL = 0x01;
const MODE_NETWORK = 0x02;

const MODE_QUERY_NONE = 0x00;
const MODE_QUERY_STARTED = 0x01;
const MODE_QUERY_FINISHED = 0x02;

let MAXCHANNELS = 0;

const CMDPING = '/*Type;';
const CMDWAITQUEUE_1000 = 1000;

let mode = MODE_NONE;
let mode_query = MODE_QUERY_NONE;
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

let bQueryComplete_Routing;

let bWaitingForResponse = false;
//let arrQuery = [];
let arrStateQuery_Routing = [];


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

		//----Laenge von arrCMD; der Command-Queue
		await this.setObjectAsync('queuelength', {
			type: 'state',
			common: {
				name: 'Length of Command-Queue',
				type: 'number',
				role: 'level',
				read: true,
				write: false
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

		// Kombinatinen von Ein- und Ausgang als bool
		for (var i = 0; i < parentThis.MAXCHANNELS; i++) {
			for (var j = 0; j < parentThis.MAXCHANNELS; j++) {
				await this.setObjectAsync('SelectBool.input_' + (i + 1).toString().padStart(2, '0') + '_out_' + (j + 1).toString().padStart(2, '0'), {
					type: 'state',
					common: {
						name: 'Connect Input to Output as boolean',
						type: 'boolean',
						def: 'false',
						role: 'indicator',
						read: true,
						write: true
					},
					native: {},
				});
			}
		}

		for (var i = 0; i < parentThis.MAXCHANNELS; i++) {
			// Kombinatinen von Ein- und Ausgang als Nummer ('Eingang 1 auf X')
			//for (var i = 0; i < MAXCHANNELS; i++) {
			//	for (var j = 0; j < MAXCHANNELS; j++) {
			await this.setObjectAsync('SelectNumber.input_' + (i + 1).toString().padStart(2, '0') + '_out_to', {
				type: 'state',
				common: {
					name: 'Connect Input to numbered Output',
					type: 'number',
					//def: 0,
					//states: { 0: 'Off', 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6' },
					states: { 0: 'Off', 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6' },
					role: 'list',
					read: true,
					write: true
				},
				native: {},
			});
		}

		for (var i = 0; i < parentThis.MAXCHANNELS; i++) {
			await this.setObjectAsync('Labels.input_' + (i + 1).toString().padStart(2, '0'), {
				type: 'state',
				common: {
					name: 'Input-Name',
					type: 'string',
					//def: 0,
					//states: { 0: 'Off', 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6' },
					role: 'text',
					read: true,
					write: true,
					def: 'Eingang ' + (i + 1).toString().padStart(2, '0')
				},
				native: {},
			});
		}

		for (var i = 0; i < parentThis.MAXCHANNELS; i++) {
			await this.setObjectAsync('Labels.output_' + (i + 1).toString().padStart(2, '0'), {
				type: 'state',
				common: {
					name: 'Output-Name',
					type: 'string',
					role: 'text',
					read: true,
					write: true,
					def: 'Ausgang ' + (i + 1).toString().padStart(2, '0')
				},
				native: {},
			});
		}
	}

	async readLabels() {
		let id = 'Labels.input_' + (1).toString().padStart(2, '0');
		var wert = await this.getStateAsync(id);
		this.log.info('readLabels():' + wert.val);

		var wert2 = await this.getStateAsync('Labels.input_' + (1).toString().padStart(2, '0'));
		this.log.info('readLabels() 2:' + wert2.val);
	}


	initMatrix() {
		this.log.info('initMatrix().');

		arrCMD = [];
		mode = MODE_NONE;
		mode_query = MODE_QUERY_NONE;
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
		if (parentThis.mode == MODE_SERIAL) {
			this.log.info('disConnectMatrix() Serial');
			if (matrix.isOpen) {
				matrix.close();
				matrix.destroy();
			}
		} else if (parentThis.mode == MODE_NETWORK) {
			this.log.info('disConnectMatrix() Network');
		}
		matrix.destroy();
	}

	connectMatrix(cb) {
		//this.log.debug('connectMatrix()');
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
			//----Alle x Sekunden ein PING
			pingInterval = setInterval(function () {
				parentThis.pingMatrix();
			}, 3000);

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
			//parentThis.log.info('matrix.onData():' + chunk + ' ' + toHexString(chunk));
			if (parentThis.mode == MODE_SERIAL) {
				//parentThis.processIncoming(chunk);
			} else if (parentThis.mode == MODE_NETWORK) {
				parentThis.processIncoming(chunk);
			}
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
			//parentThis.log.debug('parser.onData():' + chunk);
			if (parentThis.mode == MODE_SERIAL) {
				//----Hier kommt schon die komplette Response an
				parentThis.processIncoming(chunk);
			}
			//parentThis.processIncoming(chunk);
		});

		//----Den Zustand der Hardware abfragen
		//		this.queryMatrix();
	}

	pingMatrix() {
		//this.log.info('pingMatrix(): 1');
		if (this.mode == MODE_SERIAL) {
			if (bWaitQueue == false) {
				if (arrCMD.length == 0) {
					//parentThis.log.debug('pingMatrix() seriell');
					arrCMD.push(CMDPING);
					iMissedPingCounter = 0;
				}
			}
		} else if (this.mode == MODE_NETWORK) {
			this.log.info('pingMatrix(): 5');
			// ---   ALL TO BE DONE
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

	//----Fragt die Werte vom Geraet ab.
	queryMatrix() {
		this.log.debug('VideoMatrix: queryMatrix(). arrCMD.length vorher=' + arrCMD.length.toString());
		parentThis.mode_query = MODE_QUERY_STARTED;
		parentThis.arrStateQuery_Routing = [];
		//parentThis.arrQuery = [];
		for (let i = 0; i < parentThis.MAXCHANNELS; i++) {
			//arrQuery.push("Status" + (i + 1).toString() + ".");
			arrCMD.push("Status" + (i + 1).toString() + ".");
			parentThis.arrStateQuery_Routing.push(false);
		}

		this.setState('queryState', true, true);
		/*
		arrQuery.forEach(function (item, index, array) {
			//parentThis.log.info('VideoMatrix: queryMatrix(). pushing:' + item);
			arrCMD.push(item);
		});
		*/
		//this.log.debug('VideoMatrix: queryMatrix(). arrCMD.length hinterher=' + arrCMD.length.toString());
		//iMaxTryCounter = 3;
	}

	//----stellt fest, ob das Abfragen der Werte von der Hardware vollstaendig ist.
	checkQueryDone() {
		if (parentThis.mode_query == MODE_QUERY_STARTED) {
			let bTMP_Routing_done = true;
			var sRouting = 'Routing:';
			parentThis.arrStateQuery_Routing.forEach(function (item, index, array) {
				bTMP_Routing_done = bTMP_Routing_done && item;
				sRouting += item.toString() + ' ';
			});
			//bQueryComplete_Routing = bTMP_Routing;
			if (bTMP_Routing_done == true) {
				parentThis.mode_query = MODE_QUERY_FINISHED;
			}
			this.log.debug('checkQueryDone(): Routing (bool):' + bTMP_Routing_done);
			//this.log.debug('checkQueryDone(): Routing:' + sRouting);
		} else if (parentThis.mode_query == MODE_QUERY_NONE) {
			this.log.debug('checkQueryDone(): mode_query ist NONE');
		} else if (parentThis.mode_query == MODE_QUERY_FINISHED) {
			this.log.debug('checkQueryDone(): Abfrage auf Routing bereits komplett.');
		}


		//this.setState('info.connection', bQueryDone, true);
		this.setState('queryState', false, true);
	}

	//wird alle 100ms aufgerufen. Die CMD-Queue wird abgearbeitet und Befehle gehen raus.
	processCMD() {
		//this.log.info('processCMD()');

		// nur ein test, um die labesl auszulesen	
		this.readLabels();


		if (bWaitQueue == false) {
			if (bWaitingForResponse == false) {
				if (arrCMD.length > 0) {
					this.log.debug('processCMD: bWaitingForResponse==FALSE, arrCMD.length=' + arrCMD.length.toString());
					bWaitingForResponse = true;
					let tmp = arrCMD.shift();
					this.log.debug('processCMD: next CMD=' + tmp);
					bHasIncomingData = false;
					matrix.write(tmp);
					matrix.write('\n');
					if (query) {
						clearTimeout(query);
					}
					query = setTimeout(function () {
						//----5 Sekunden keine Antwort und das Teil ist offline
						if (bHasIncomingData == false) {
							//----Nach x Milisekunden ist noch gar nichts angekommen....
							parentThis.log.error('processCMD(): KEINE EINKOMMENDEN DATEN NACH ' + TIMEOUT.toString() + ' Milisekunden. OFFLINE?');
							parentThis.bConnection = false;
							//this.setState('info.connection', bConnection, true); //Green led in 'Instances'
							parentThis.disconnectMatrix();
							parentThis.initMatrix();
						} else {
							parentThis.log.info('processCMD(): Irgendetwas kam an... es lebt.');
						}
					}, TIMEOUT);
				} else {
					//this.log.debug('processCMD: bWaitingForResponse==FALSE, arrCMD ist leer. Kein Problem');
				}
			} else {
				//this.log.debug('AudioMatrix: processCMD: bWaitingForResponse==TRUE. Nichts machen');
			}
		} else {
			this.log.debug('processCMD: bWaitQueue==TRUE, warten');
		}

		//----Anzeige der Quelength auf der Oberflaeche
		//        this.setStateAsync('queuelength', { val: arrCMD.length, ack: true });
		//

	}

	// Verarbeitung eingehender Daten
	processIncoming(chunk) {
		bHasIncomingData = true; // IrgendETWAS ist angekommen
		this.log.debug('processIncoming():' + chunk);


		if (this.mode == MODE_SERIAL) {
			//----Wegen des Parsers enthaelt <chunk> die komplette Response
			if (bWaitingForResponse == true) {
				this.parseMSG(chunk);
				bWaitingForResponse = false;
				bConnection = true;
				//this.setState('info.connection', bConnection, true); //Green led in 'Instances'
				in_msg = '';
			} else {
				// einkommende Daten ohne, dass auf eine Response gewartet wird entstehen, 
				// wenn an der Oberfläche etwas geändert wird. bsp: '/1V3.'
				this.log.info(': processIncoming() Serial: bWaitingForResponse==FALSE; in_msg:' + chunk);
				this.parseMSG(chunk);
			}
		} else if (parentThis.mode == MODE_NETWORK) {
			this.log.info('processIncoming() Mode_Network: TBD');
			in_msg += chunk;
			//....if in_msg == complete....
			if (bWaitingForResponse == true) {
				this.parseMSG(chunk);
				bWaitingForResponse = false;
				bConnection = true;
				in_msg = '';
			} else {
				this.log.info(': processIncoming() Network: bWaitingForResponse==FALSE; in_msg:' + in_msg);
			}
		}

		if (in_msg.length > 120) {
			//----Just in case
			in_msg = '';
		}

		//----Anzeige der Quelength auf der Oberflaeche
		this.setStateAsync('queuelength', { val: arrCMD.length, ack: true });
	}

	//----Data coming from hardware
	//----bWaitingForResponse==TRUE: reaktion auf Gui-Command
	//----bWaitingForResponse==FALSE: Routing an der Hardware wurde geaendert
	parseMSG(sMSG) {
		// z.b: HDMI36X36
		if (sMSG.toLowerCase().includes('hdmi')) {
			//....something something.
		} else if (sMSG.toLowerCase().endsWith('close.')) {
			// Ausgang wird ausgeschaltet
			// z.B.: '/3 Close.'
			let iStart = sMSG.indexOf('/') + 1;
			let tmpOUT = sMSG.substring(iStart, sMSG.indexOf(' '));
			parentThis.log.info('parseMSG(): OFF:' + tmpOUT);

			for (let i = 0; i < parentThis.MAXCHANNELS; i++) {
				this.log.debug('fixExclusiveRoutingStates(): Setzte Eingang ' + (i + 1).toString() + ' fuer Ausgang ' + tmpOUT + ' auf FALSE');
				this.setStateAsync('input_' + (i + 1).toString().padStart(2, '0') + '_out_' + (tmpOUT).toString().padStart(2, '0'), { val: false, ack: true });
			}

		} else if (sMSG.toLowerCase().startsWith('/v:')) {
			//----Ein Ergebnis der Query
			let iStart = sMSG.indexOf(':') + 1;
			let tmpIN = sMSG.substring(iStart, sMSG.indexOf(' '));
			let tmpOUT = sMSG.substring(sMSG.lastIndexOf(' ') + 1).trim();
			//this.log.info('parseMsg(): Routing Query Answer: IN:' + tmpIN + '; OUT:' + tmpOUT + ';');

			this.setStateAsync('input_' + (tmpIN).toString().padStart(2, '0') + '_out_' + (tmpOUT).toString().padStart(2, '0'), { val: true, ack: true });
			parentThis.arrStateQuery_Routing[parseInt(tmpOUT) - 1] = true;
			parentThis.checkQueryDone();

		} else if (sMSG.toLowerCase().startsWith('/')) {
			//----Repsonse auf gesetztes Routing, Obacht bei der Reihenfolge.
			//----Response z.B. /1V3.
			let iTrenner = sMSG.toLowerCase().indexOf('v');
			let sEingang = sMSG.substring(1, iTrenner);
			let sAusgang = sMSG.substring(iTrenner + 1, sMSG.indexOf('.'));
			if (bWaitingForResponse == true) {
				this.log.info('parseMsg(): SET Routing Answer: IN:' + sEingang + '; OUT:' + sAusgang + ';');
			} else {
				this.log.info('parseMsg(): Aenderung an der Hardware: IN:' + sEingang + '; OUT:' + sAusgang + ';');
				this.setStateAsync('input_' + (sEingang).toString().padStart(2, '0') + '_out_' + (sAusgang).toString().padStart(2, '0'), { val: true, ack: true });
			}

			for (let i = 0; i < parentThis.MAXCHANNELS; i++) {
				if (i + 1 != parseInt(sEingang)) {
					this.log.debug('fixExclusiveRoutingStates(): Setzte Eingang ' + (i + 1).toString() + ' fuer Ausgang ' + sAusgang + ' auf FALSE');
					this.setStateAsync('input_' + (i + 1).toString().padStart(2, '0') + '_out_' + (sAusgang).toString().padStart(2, '0'), { val: false, ack: true });
				}
			}
		} else {
			this.log.info('VideoMatrix: parseMsg() Response unhandled:' + sMSG);
		}
	}

	//----Ein State wurde veraendert. wir verarbeiten hier nur ack==FALSE
	//----d.h.: Aenderungen, die ueber die GUI kommen.
	//----Wenn das Routing an der Hardware geaendert wird, kommt die info via parseMSG herein.
	matrixChanged(id, val, ack) {
		//parentThis.log.info('matrixChanged() id:' + id);	//z.B. input_01_out_02
		if (id.toString().includes('SelectBool.input_')) {
			let sEingang = id.substring(id.indexOf('input_') + 6, id.indexOf('_out'));
			let sAusgang = id.substring(id.indexOf('_out_') + 5);

			if (ack == false) {	//Aenderung per GUI
				parentThis.log.info('matrixChanged(): Neues Routing via GUI: IN:' + sEingang + ', OUT:' + sAusgang + '.Wert:' + val.toString() + '.Ende');
				let cmdRoute;
				if (val == true) {
					cmdRoute = sEingang + 'V' + sAusgang + '.';
					//this.setStateAsync('input_' + (pIN).toString().padStart(2, '0') + '_out_' + (pOUT).toString().padStart(2, '0'), { val: true, ack: true });
				} else {
					//----Ausschalten
					cmdRoute = sAusgang + '$.';
					//this.setStateAsync('input_' + (pIN).toString().padStart(2, '0') + '_out_' + (pOUT).toString().padStart(2, '0'), { val: false, ack: true });
				}
				//parentThis.log.debug('matrixChanged() via GUI. cmd=' + cmdRoute);
				arrCMD.push(cmdRoute);
			} else {
				//parentThis.log.debug('matrixChanged() via HARDWARE');
			}

		} else if (id.toString().includes('Numbered.input_')) {
			parentThis.log.info('matrixChanged(): Neues Routing via Numbered:' + id);
		}

		/*
			//this.log.info('Neues Routing: IN: Ein Ausgang kann nur einen definierten Eingang besitzen');
			for (let i = 0; i < parentThis.MAXCHANNELS; i++) {
				if (i + 1 != parseInt(sEingang)) {
					//this.log.debug('matrixChanged(): Neues Routing: IN: Ein Ausgang kann nur einen definierten Eingang besitzen. Setzte Eingang ' + (i + 1).toString() + ' fuer Ausgang ' + sAusgang + ' auf FALSE');
					this.setStateAsync('input_' + (i + 1).toString().padStart(2, '0') + '_out_' + (sAusgang).toString().padStart(2, '0'), { val: false, ack: true });
				}
			}
			*/
	}
	//}//----ack==FALSE                         


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

		this.log.info("Matrix Type:" + this.config.optSlotcount);
		if (this.config.optSlotcount == '10x10') {
			parentThis.MAXCHANNELS = 10;
		} else if (this.config.optSlotcount == '18x18') {
			parentThis.MAXCHANNELS = 18;
		} else if (this.config.optSlotcount == '36x36') {
			parentThis.MAXCHANNELS = 36;
		} else if (this.config.optSlotcount == '72x72') {
			parentThis.MAXCHANNELS = 72;
		} if (this.config.optSlotcount == '144x144') {
			parentThis.MAXCHANNELS = 144;
		}

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

		//this.createStates();

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
		this.createStates();

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
			//this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
			parentThis.matrixChanged(id, state.val, state.ack);
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