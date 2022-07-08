'use strict';

/*
 * Created with @iobroker/create-adapter v1.25.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

const net = require('net');
//const serialport = require('serialport');
//const Readline = require('@serialport/parser-readline')
// const ByteLength = require('@serialport/parser-byte-length');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const { debug } = require('console');
const TIMEOUT = 5000;

const MODE_NONE = 0x00;
const MODE_SERIAL = 0x11;
const MODE_NETWORK = 0x12;

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
let iMaxTryCounter;
let iMaxTimeoutCounter;

let inputNames = {};
let outputNames = {};

let arrInputNames = [];
let lstInputNames = '';

let sList_In = '';
let sList_Out = '';
let sList_values = '';

//-------
let query = null;
let in_msg = '';
let lastCMD = '';

//let bQueryComplete_Routing;
let bWaitingForResponse = false;

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

		await this.setObjectAsync('info.connection', {
			type: 'state',
			common: {
				name: 'True: Hardware is responding',
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
				await this.setObjectAsync('input_' + (i + 1).toString().padStart(2, '0') + '_out_' + (j + 1).toString().padStart(2, '0'), {
					type: 'state',
					common: {
						name: 'Connect Input ' + (i + 1).toString() + ' to Output ' + (j + 1).toString() + ' as boolean',
						type: 'boolean',
						def: false,
						role: 'indicator',
						read: true,
						write: true
					},
					native: {},
				});
			}
		}


		await this.setObjectAsync('Labels.input_' + (0).toString().padStart(2, '0'), {
			type: 'state',
			common: {
				name: 'Off',
				type: 'string',
				role: 'text',
				read: true,
				write: true,
				def: 'Off'
			},
			native: {},
		});

		for (var i = 0; i < parentThis.MAXCHANNELS; i++) {
			await this.setObjectAsync('Labels.input_' + (i + 1).toString().padStart(2, '0'), {
				type: 'state',
				common: {
					name: 'Input ' + (i + 1).toString().padStart(2, '0'),
					type: 'string',
					//def: 0,
					//states: { 0: 'Off', 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6' },
					//states: inputNames,
					role: 'text',
					read: true,
					write: true,
					def: 'Eingang ' + (i + 1).toString().padStart(2, '0')
				},
				native: {},
			});
		}

		await this.setObjectAsync('Labels.output_' + (0).toString().padStart(2, '0'), {
			type: 'state',
			common: {
				name: 'Off',
				type: 'string',
				role: 'text',
				read: true,
				write: true,
				def: 'Off'
			},
			native: {},
		});

		for (var i = 0; i < parentThis.MAXCHANNELS; i++) {
			await this.setObjectAsync('Labels.output_' + (i + 1).toString().padStart(2, '0'), {
				type: 'state',
				common: {
					name: 'Output ' + (i + 1).toString().padStart(2, '0'),
					type: 'string',
					//states: outputNames,
					role: 'text',
					read: true,
					write: true,
					def: 'Ausgang ' + (i + 1).toString().padStart(2, '0')
				},
				native: {},
			});
		}

		var tmpOff_Out = await this.getStateAsync('Labels.output_' + (0).toString().padStart(2, '0'));
		var tmpOff_In = await this.getStateAsync('Labels.input_' + (0).toString().padStart(2, '0'));
		outputNames[0] = tmpOff_Out.val;


		inputNames[0] = tmpOff_In.val;
		arrInputNames.push(tmpOff_In.val);

		for (var i = 0; i < parentThis.MAXCHANNELS; i++) {
			var tmpIn = await this.getStateAsync('Labels.input_' + (i + 1).toString().padStart(2, '0'));
			var tmpOut = await this.getStateAsync('Labels.output_' + (i + 1).toString().padStart(2, '0'));

			//----Works.
			//this.log.debug('readLabels(): adding ' + tmpIn.val);
			//this.log.debug('readLabels(): adding ' + tmpOut.val);

			inputNames[i + 1] = tmpIn.val;
			arrInputNames.push(tmpIn.val);

			outputNames[i + 1] = tmpOut.val;
		}

		//lstInputNames = '{00=OFF,01=Eingang 1,02=Eingang zwei, 03=Eingang DREI}';
		//this.log.info('createStates():' + lstInputNames);

		/*
		for (var i = 0; i < parentThis.MAXCHANNELS; i++) {
			// Kombinatinen von Ein- und Ausgang als Nummer ('Eingang 1 auf X')
			await this.setObjectAsync('SelectMapping.input_' + (i + 1).toString().padStart(2, '0') + '_out_to', {
				type: 'state',
				common: {
					name: 'Connect Input ' + (i + 1).toString().padStart(2, '0') + ' to Output',
					type: 'number',
					//def: 0,
					//states: { 0: 'Off', 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6' },
					//states: { 0: 'Off', 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6' },
					states: outputNames,
					role: 'list',
					read: true,
					write: true
				},
				native: {},
			});
			
		}
		*/

		var options = [];
		for (var i = 0; i < parentThis.MAXCHANNELS; i++) {
			//var opt = { 'value': i, 'label': 'eingang ' + i.toString() };
			var opt = { 'value': i.toString(), 'label': inputNames[i] };
			options.push(opt);
		}

		for (var i = 0; i < parentThis.MAXCHANNELS; i++) {
			// Kombinatinen von Ein- und Ausgang
			// ausgehend vom Ausgang ('Ausgang x bekommt Signal von Eingang y')
			await this.setObjectAsync('SelectMapping.output_' + (i + 1).toString().padStart(2, '0') + '_in_from', {
				type: 'state',
				common: {
					name: 'Output ' + (i + 1).toString().padStart(2, '0') + ' gets Signal from',
					type: 'number',
					states: inputNames,
					role: 'list',
					read: true,
					write: true
				},
				// Next up: addOn for using the Selection Wdiget in HABPanel
				stateDescription: {
					options
				},
				native: {},
			});
		}

		// Erzeugen von zusaetzlichen Datenpunkten, die z.B. in VIS ermöglichen, 
		// ein Dropdown-Feld zu nutzen
		for (let i = 0; i < parentThis.MAXCHANNELS; i++) {
			sList_In = sList_In + inputNames[i];
			if (i < parentThis.MAXCHANNELS - 1) {
				sList_In = sList_In + ';';
			}
		}

		for (let i = 0; i < parentThis.MAXCHANNELS; i++) {
			sList_Out = sList_Out + outputNames[i];
			if (i < parentThis.MAXCHANNELS - 1) {
				sList_Out = sList_Out + ';';
			}
		}


		for (let i = 0; i < parentThis.MAXCHANNELS; i++) {
			sList_values = sList_values + i.toString();
			if (i < parentThis.MAXCHANNELS - 1) {
				sList_values = sList_values + ';';
			}
		}

		this.log.debug('readLabels(): sList: ' + sList_In + 'HERZ HERZ HERZ');


		await this.setObjectAsync('Labels.List_Names_Input_Semicolon', {
			type: 'state',
			common: {
				name: 'Autogenerated List for use in VIS',
				type: 'string',
				role: 'text',
				def: sList_In,
				read: true,
				write: false,
				//def: sList_In
			},
			native: {},
		});

		await this.setObjectAsync('Labels.List_Names_Output_Semicolon', {
			type: 'state',
			common: {
				name: 'Autogenerated List for use in VIS',
				type: 'string',
				role: 'text',
				def: sList_Out,
				read: true,
				write: false,
				//def: sList_Out
			},
			native: {},
		});

		await this.setObjectAsync('Labels.List_Values_Input_Semicolon', {
			type: 'state',
			common: {
				name: 'Autogenerated List for use in VIS',
				type: 'string',
				role: 'text',
				def: sList_values,
				read: true,
				write: false,
				//def: sList_values
			},
			native: {},
		});

		await this.setObjectAsync('Labels.List_Values_Output_Semicolon', {
			type: 'state',
			common: {
				name: 'Autogenerated List for use in VIS',
				type: 'string',
				role: 'text',
				def: sList_values,
				read: true,
				write: false,
				//def: sList_values
			},
			native: {},
		});




		/*
		async readLabels() {
			//let id = 'Labels.input_' + (1).toString().padStart(2, '0');
			//var wert = await this.getStateAsync(id);
			this.log.info('readLabels():');
	
			//var wert2 = await this.getStateAsync('Labels.input_' + (1).toString().padStart(2, '0'));
			//var wert3 = await this.getStateAsync('Labels.output_' + (1).toString().padStart(2, '0'));
			//this.log.info('readLabels() 2:' + wert2.val + ' ' + wert3.val);
	
			for (var i = 0; i < parentThis.MAXCHANNELS; i++) {
				var tmpIn = await this.getStateAsync('Labels.input_' + (i + 1).toString().padStart(2, '0'));
				var tmpOut = await this.getStateAsync('Labels.output_' + (i + 1).toString().padStart(2, '0'));
	
				//var elementIn = { i: tmpIn.val };
				//var elementOut = { i: tmpOut.val };
	
				//inputNames.extend(elementIn);
				//outputNames.extend(elementOut);
	
				this.log.info('readLabels(): adding ' + tmpIn.val);
				this.log.info('readLabels(): adding ' + tmpOut.val);
	
				inputNames[i] = tmpIn.val;
				outputNames[i] = tmpOut.val;
			}
		}
		*/
	}

	initMatrix() {
		this.log.debug('initMatrix().');

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
			this.log.debug('disConnectMatrix() Serial');
			if (matrix.isOpen) {
				matrix.close();
				matrix.destroy();
			}
		} else if (parentThis.mode == MODE_NETWORK) {
			this.log.debug('disConnectMatrix() Network');
		}
		matrix.destroy();
	}

	connectMatrix(cb) {
		//this.log.debug('connectMatrix()');
		let parser;
		arrCMD = [];

		if (this.mode == MODE_SERIAL) {
			this.log.debug('connectMatrix(): Serial Port Mode ' + this.sSerialPortName);
			matrix = new SerialPort({
				path: this.sSerialPortName,
				baudRate: 9600,
				dataBits: 8,
				stopBits: 1,
				parity: 'none'
			});

			//parser = matrix.pipe(new ByteLength({ length: 1 }));
			parser = matrix.pipe(new ReadlineParser({ delimiter: '\r\n' }))
			if (pingInterval) {
				clearInterval(pingInterval);
			}
			//----Alle x Sekunden ein PING
			pingInterval = setInterval(function () {
				parentThis.pingMatrix();
			}, 3000);

		} else if (this.mode == MODE_NETWORK) {
			this.log.debug('connectMatrix():' + this.config.optHost + ':' + this.config.optPort);
			matrix = new net.Socket();
			matrix.connect(this.config.optPort, this.config.optHost, function () {
				clearInterval(query);
				query = setInterval(function () {
					if (bConnection == false) {
						if (bWaitingForResponse == false) {
							parentThis.log.debug('VideoMatrix: connectMatrix().connection==false, sending CMDPING:' + cmdPing);
							arrCMD.push(cmdPing);
							parentThis.iMaxTryCounter = 3;
							parentThis.processCMD();
						} else {
							parentThis.log.debug('VideoMatrix: connectMatrix().bConnection==false, bWaitingForResponse==false; nichts machen');
						}
					} else {
						if (parentThis.mode_query == MODE_QUERY_FINISHED) {
							if (arrCMD.length == 0) {
								parentThis.log.debug('VideoMatrix: connectMatrix().connection==true, bQueryDone==TRUE, idle, pinging Matrix');
								parentThis.pingMatrix();
							} else {
								parentThis.log.debug('VideoMatrix: connectMatrix().connection==true, bQueryDone==TRUE, arrCMD.length>0; idle, aber KEIN ping auf Matrix');
							}
						} else {
							if (!parentThis.mode_query == MODE_QUERY_STARTED) {
								parentThis.log.debug('VideoMatrix: connectMatrix().connection==true, bQueryDone==FALSE, idle, query Matrix');
								parentThis.queryMatrix();
							} else {
								parentThis.log.debug('VideoMatrix: connectMatrix().connection==true, bQueryDone==FALSE, bQueryInProgress==TRUE, idle');
								parentThis.queryMatrix();
							}
						}
					}

					//-	---Intervall fuer Befehle, Timeouts, etc
					setTimeout(function () {
						//parentThis.log.info('VideoMatrix: connectMatrix(): kleines Timeout');
						if (bWaitingForResponse == true) {
							if (!this.mode_query == MODE_QUERY_STARTED) {
								if (parentThis.iMaxTryCounter > 0) {
									//----Es kann passieren, dass man direkt NACH dem Senden eines Befehls an die Matrix und VOR der Antwort hier landet.
									//----deswegen wird erstmal der MaxTryCounter heruntergesetzt und -sofern nichts kommt- bis zum naechsten Timeout gewartet.
									//----Wenn iMaxTryCounter==0 ist, koennen wir von einem Problem ausgehen
									parentThis.log.warn('VideoMatrix: connectMatrix(): kleines Timeout. bWaitingForResponse==TRUE iMaxTryCounter==' + parentThis.iMaxTryCounter.toString());
									parentThis.log.warn('VideoMatrix: connectMatrix(): kleines Timeout. lastCMD =' + parentThis.lastCMD + '. MinorProblem = TRUE');
									parentThis.iMaxTryCounter--;
									parentThis.setState('minorProblem', true, true);
								} else {
									if (parentThis.iMaxTimeoutCounter < 3) {
										parentThis.log.warn('VideoMatrix: connectMatrix() in_msg: kleines Timeout. bWaitingForResponse==TRUE iMaxTryCounter==0. Erneutes Senden von ' + parentThis.lastCMD);
										parentThis.iMaxTimeoutCounter++;
										parentThis.iMaxTryCounter = 3;
										if (parentThis.lastCMD !== undefined) {
											setTimeout(function () {
												matrix.write(parentThis.lastCMD + '\n\r');
											}, 100);
										}
									} else {
										parentThis.log.warn('VideoMatrix: connectMatrix() in_msg: kleines Timeout. bWaitingForResponse==TRUE iMaxTryCounter==0. Erneutes Senden von ' + parentThis.lastCMD + ' schlug mehrfach fehl');
										parentThis.iMaxTimeoutCounter = 0;
										parentThis.log.warn('VideoMatrix: connectMatrix() in_msg: kleines Timeout. bWaitingForResponse==TRUE iMaxTryCounter==0');
										//parentThis.log.error('WIE reagieren wir hier drauf? Was ist, wenn ein Befehl nicht umgesetzt werden konnte?');
										bWaitingForResponse = false;
										parentThis.lastCMD = '';
										in_msg = '';
										arrCMD = [];
										parentThis.disconnectMatrix();
										parentThis.initMatrix();
									}
								}
							} else {
								//parentThis.setState('minorProblem', true, true);
								if (connection == true) {
									parentThis.log.warn('VideoMatrix: connectMatrix(): kleines Timeout. bWaitingForResponse==TRUE, bQueryInProgress==TRUE. Abwarten. iMaxTryCounter==' + parentThis.iMaxTryCounter.toString());
								} else {
									//----Fuer den Fall, dass der Verbindungsversuch fehlschlaegt
									parentThis.log.warn('VideoMatrix: connectMatrix(): kleines Timeout. bWaitingForResponse==TRUE, bQueryInProgress==TRUE. Connection==FALSE. iMaxTryCounter==' + parentThis.iMaxTryCounter.toString());
									bWaitingForResponse = false;
									parentThis.iMaxTryCounter--;
								}
							}
						} else {
							parentThis.log.debug('VideoMatrix: connectMatrix() in_msg: kleines Timeout. bWaitingForResponse==FALSE, kein Problem');
						}
					}, 333/*kleinesIntervall*/);
				}, 5000);

				if (cb) {
					cb();
				}
			}).on('data', function (chunk) {
				//parentThis.log.info('matrix.onData():' + chunk);
				if (parentThis.mode == MODE_SERIAL) {
					//parentThis.processIncoming(chunk);
				} else if (parentThis.mode == MODE_NETWORK) {
					parentThis.processIncoming(chunk);
				}

			}).on('timeout', function (e) {
				//if (e.code == 'ENOTFOUND' || e.code == 'ECONNREFUSED' || e.code == 'ETIMEDOUT') {
				//            matrix.destroy();
				//}
				parentThis.log.error('VideoMatrix TIMEOUT. TBD');
				//parentThis.connection=false;
				//parentThis.setConnState(false, true);
				//            parentThis.reconnect();
			}).on('error', function (e) {
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
			}).on('close', function (e) {
				//if (bConnection) {
				parentThis.log.debug('VideoMatrix closed. TBD');
				//}
				//parentThis.reconnect();
			}).on('disconnect', function (e) {
				parentThis.log.debug('VideoMatrix disconnected. TBD');
				//            parentThis.reconnect();
			}).on('end', function (e) {
				parentThis.log.error('VideoMatrix ended');
				//parentThis.setState('info.connection', false, true);
			});

		}

		/*
		parser.on('data', function (chunk) {
			//parentThis.log.debug('parser.onData():' + chunk);
			if (parentThis.mode == MODE_SERIAL) {
				//----Hier kommt schon die komplette Response an
				parentThis.processIncoming(chunk);
			}
			parentThis.processIncoming(chunk);
		});
		*/

		//----Den Zustand der Hardware abfragen
		this.queryMatrix();
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
			this.log.debug('pingMatrix(): 5');
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
					this.log.warn('pingMatrix(): 10 mal No Connection. Erzwinge Reconnect');
					parentThis.disconnectMatrix();
					parentThis.initMatrix();
				}

			}
		}
	}

	//----Fragt die Werte vom Geraet ab.
	queryMatrix() {
		// this.log.debug('queryMatrix(). arrCMD.length vorher=' + arrCMD.length.toString());
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
		//this.log.debug('queryMatrix(): arrCMD.length hinterher=' + arrCMD.length.toString());
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

		// nur ein test, um die labels auszulesen	
		//this.readLabels();
		if ((matrix != null) && (bWaitQueue == false)) {
			if (bWaitingForResponse == false) {
				if (arrCMD.length > 0) {
					this.log.debug('processCMD: bWaitingForResponse==FALSE, arrCMD.length=' + arrCMD.length.toString());
					bWaitingForResponse = true;
					//let tmp = arrCMD.shift();
					//this.log.debug('processCMD: next CMD=' + tmp);
					//matrix.write(tmp);
					bHasIncomingData = false;
					let lastCMD = arrCMD.shift();
					this.log.debug('processCMD: next CMD=' + lastCMD);
					matrix.write(lastCMD);
					matrix.write('\n');
					if (query) {
						clearTimeout(query);
					}
					query = setTimeout(function () {
						//----5 Sekunden keine Antwort und das Teil ist offline
						if (bHasIncomingData == false) {
							//----Nach x Milisekunden ist noch gar nichts angekommen....
							parentThis.log.info('processCMD(): KEINE EINKOMMENDEN DATEN NACH ' + TIMEOUT.toString() + ' Milisekunden. OFFLINE?');
							parentThis.bConnection = false;
							parentThis.setState('info.connection', bConnection, true); //Green led in 'Instances'
							parentThis.disconnectMatrix();
							parentThis.initMatrix();
						} else {
							parentThis.log.debug('processCMD(): Irgendetwas kam an... es lebt.');
						}
					}, TIMEOUT);
				} else {
					// this.log.debug('processCMD: bWaitingForResponse==FALSE, arrCMD ist leer. Kein Problem');
				}
			} else {
				//this.log.debug('AudioMatrix: processCMD: bWaitingForResponse==TRUE. Nichts machen');
			}
		} else {
			this.log.debug('processCMD: bWaitQueue==TRUE, warten');
		}

		//----Anzeige der Quelength auf der Oberflaeche
		this.setStateAsync('queuelength', { val: arrCMD.length, ack: true });
		//

	}

	// Verarbeitung eingehender Daten
	processIncoming(chunk) {
		bHasIncomingData = true; // IrgendETWAS ist angekommen
		//this.log.debug('processIncoming():' + chunk);


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
				this.log.debug(': processIncoming() Serial: bWaitingForResponse==FALSE; in_msg:' + chunk);
				this.parseMSG(chunk);
			}
		} else if (parentThis.mode == MODE_NETWORK) {
			//this.log.info('processIncoming() Mode_Network: TBD');
			in_msg += chunk;
			//....if in_msg == complete....
			if (in_msg.indexOf('\r\n') > -1) {
				if (bWaitingForResponse == true) {
					this.log.debug('processIncoming() Mode_Network: Message complete:' + in_msg);
					this.parseMSG(in_msg);
					bWaitingForResponse = false;
					bConnection = true;
					parentThis.setState('info.connection', bConnection, true); //Green led in 'Instances'
					in_msg = '';
				} else {
					//----Hier landen wir auch, wenn an der Hardware das Routing veraendert wurde
					this.log.debug(': processIncoming() Network: bWaitingForResponse==FALSE; in_msg:' + in_msg);
					this.parseMSG(in_msg);
					in_msg = '';
					//this.setBooleanRouting(in_msg, true);
				}
			} else {
				//this.log.info('processIncoming() Mode_Network: Message not complete:' + in_msg);
			}
		}

		if (in_msg.length > 120) {
			//----Just in case
			in_msg = '';
		}

		//----Anzeige der Quelength auf der Oberflaeche
		this.setStateAsync('queuelength', { val: arrCMD.length, ack: true });
	}

	//---Ein Eingang und ein Ausgang wurden verknuepft, das Setzen der States gehschieht hier
	//----Sowohl intern, wenn ueber die GUI, als auch extern, wenn Daten einkommen
	setBooleanRouting(sMSG, bAck) {

		sMSG = sMSG.toString().trim();

		//this.log.debug('setBooleanRouting():-' + sMSG + '- ' + bAck.toString());

		sMSG = sMSG.toString().replace('/V:', '');	// Von einer query
		sMSG = sMSG.toString().replace(' -> ', 'V');// Von einer Query
		sMSG = sMSG.toString().replace('.', '');// Von einer Query
		sMSG = sMSG.toString().replace('/', ''); // Von vorne

		//this.log.debug('setBooleanRouting():+' + sMSG + '+ ' + bAck.toString());

		let iTrenner = sMSG.toLowerCase().indexOf('v');
		let sEingang = sMSG.substring(0, iTrenner);
		let sAusgang = sMSG.substring(iTrenner + 1);

		//this.log.debug('setBooleanRouting(): IN:+' + sEingang + '+ OUT: +' + sAusgang + '+');


		//----Wenn an der Matrix ein Eingang 'to All' geschaltet wird, muessen wir verzweigen

		if (sMSG.indexOf('To All') == -1) {
			this.log.debug('setBooleanRouting: IN:' + sEingang + '; OUT:' + sAusgang + ';');
			this.setStateAsync('input_' + (sEingang).toString().padStart(2, '0') + '_out_' + (sAusgang).toString().padStart(2, '0'), { val: true, ack: bAck });

			this.cleanupBooleanRouting(sEingang, sAusgang);
		}

	}

	//----Schaltet die uebrigen Zustaenden beim Boolschen Routing aus
	cleanupBooleanRouting(sIN, sOUT) {
		for (let i = 0; i < parentThis.MAXCHANNELS; i++) {
			if (i + 1 != parseInt(sIN)) {
				this.log.debug('cleanBooleanRouting(): Setzte Eingang ' + (i + 1).toString() + ' fuer Ausgang ' + sOUT + ' auf FALSE');
				this.setStateAsync('input_' + (i + 1).toString().padStart(2, '0') + '_out_' + (sOUT).toString().padStart(2, '0'), { val: false, ack: true });
				//this.setStateAsync('SelectMapping.input_' + (i + 1).toString().padStart(2, '0') + '_out_to', { val: sAusgang, ack: true });
			}
		}
	}

	//----Data coming from hardware
	//----bWaitingForResponse==TRUE: reaktion auf Gui-Command
	//----bWaitingForResponse==FALSE: Routing an der Hardware wurde geaendert

	//---- 2Do: /1 to All.
	parseMSG(sMSG) {
		// z.b: HDMI36X36
		sMSG = sMSG.toString();
		if (sMSG.toLowerCase().includes('hdmi')) {
			//....something something.
		} else if (sMSG.toLowerCase().endsWith('close.')) {
			// Ausgang wird ausgeschaltet
			// z.B.: '/3 Close.'
			let iStart = sMSG.indexOf('/') + 1;
			let tmpOUT = sMSG.substring(iStart, sMSG.indexOf(' '));
			parentThis.log.debug('parseMSG(): OFF:' + tmpOUT);
			//  Derzeit kein Fix fuer exklusives Routing, weil sich an der Matrix selbst ein Ausgang nicht auf OFF schalten lässe
		} else if (sMSG.toLowerCase().includes('all.')) {
			// /1 to All. Das passiert vornehmlich an der Matrix
			let iStart = sMSG.indexOf('/') + 1;
			let tmpIN = sMSG.substring(iStart, sMSG.indexOf(' '));

			if (bWaitingForResponse == true) {
				parentThis.log.debug('parseMSG(): to All:' + tmpIN);
			} else {
				parentThis.log.debug('parseMSG(): an der Hardware to All:' + tmpIN);
				for (let i = 0; i < parentThis.MAXCHANNELS; i++) {
					this.setStateAsync('SelectMapping.output_' + (i + 1).toString().padStart(2, '0') + '_in_from', { val: parseInt(tmpIN, 10), ack: true });
				}
			}
		} else if (sMSG.toLowerCase().startsWith('/v:')) {
			//----Ein Ergebnis der Query
			this.setBooleanRouting(sMSG, true)

			//this.setStateAsync('SelectMapping.output_' + (tmpOUT).toString().padStart(2, '0') + '_in_from', { val: parseInt(tmpIN, 10), ack: true });
			let tmpOUT = sMSG.substring(sMSG.lastIndexOf(' ') + 1).trim();
			parentThis.arrStateQuery_Routing[parseInt(tmpOUT) - 1] = true;
			parentThis.checkQueryDone();


		} else if (sMSG.toLowerCase().startsWith('/')) {
			//----Repsonse auf per GUI oder auch Hardware gesetztes Routing, Obacht bei der Reihenfolge.
			//----Response z.B. /1V3. Weil wir ACK nicht uebergeben, behelfen wir uns mit bWaitingForResponse. Das ist schlecht
			//
			//----bWaitingForResponse == FALSE: Einkommende Daten kommen per Schalten an der Hardware
			let iTrenner = sMSG.toLowerCase().indexOf('v');
			let sEingang = sMSG.substring(1, iTrenner);
			let sAusgang = sMSG.substring(iTrenner + 1, sMSG.indexOf('.'));
			if (bWaitingForResponse == true) {
				this.log.debug('parseMsg(): SET Routing Answer: IN:' + sEingang + '; OUT:' + sAusgang + ';');
			} else {
				this.log.debug('parseMsg(): Aenderung an der Hardware: IN:' + sEingang + '; OUT:' + sAusgang + ';');
			}

			//----OBACHT: setBooleanRouting erwartet das ACK-Flag als zweiten Paramter
			//----bWaitingForResponse==FALSE -> ACK = TRUE
			this.setBooleanRouting(sMSG, true);
			this.cleanupBooleanRouting(sEingang, sAusgang)


		} else {
			this.log.warn('VideoMatrix: parseMsg() Response unhandled:' + sMSG);
		}
	}

	//----Ein State wurde veraendert. wir verarbeiten hier nur ack==FALSE
	//----d.h.: Aenderungen, die ueber die GUI kommen.
	//----Wenn das Routing an der Hardware geaendert wird, kommt die info via parseMSG herein.
	matrixChanged(id, val, ack) {
		//parentThis.log.info('matrixChanged() id:' + id);	//z.B. input_01_out_02
		if (id.toString().includes('input_')) {
			let sEingang = id.substring(id.indexOf('input_') + 6, id.indexOf('_out'));
			let sAusgang = id.substring(id.indexOf('_out_') + 5);

			if (ack == false) {	//Aenderung per GUI
				parentThis.log.debug('matrixChanged(): Neues Routing via GUI: IN:' + sEingang + ', OUT:' + sAusgang + '.Wert:' + val.toString() + '.Ende');
				let cmdRoute;
				if (val == true) {
					cmdRoute = sEingang + 'V' + sAusgang + '.';
					//this.setStateAsync('input_' + (pIN).toString().padStart(2, '0') + '_out_' + (pOUT).toString().padStart(2, '0'), { val: true, ack: true });
				} else {
					//----Ausschalten
					cmdRoute = sAusgang + '$.';
					//this.setStateAsync('input_' + (pIN).toString().padStart(2, '0') + '_out_' + (pOUT).toString().padStart(2, '0'), { val: false, ack: true });
				}
				parentThis.log.debug('matrixChanged() via GUI. cmd=' + cmdRoute);
				arrCMD.push(cmdRoute);
			} else {
				//parentThis.log.debug('matrixChanged() via HARDWARE');
			}

			/*
			this.log.info('Neues Routing: IN: Ein Ausgang kann nur einen definierten Eingang besitzen');
			for (let i = 0; i < parentThis.MAXCHANNELS; i++) {
				if (i + 1 != parseInt(sEingang)) {
					this.log.debug('matrixChanged(): Neues Routing: IN: Ein Ausgang kann nur einen definierten Eingang besitzen. Setzte Eingang ' + (i + 1).toString() + ' fuer Ausgang ' + sAusgang + ' auf FALSE');
					this.setStateAsync('input_' + (i + 1).toString().padStart(2, '0') + '_out_' + (sAusgang).toString().padStart(2, '0'), { val: false, ack: true });
				}
			}
			*/
		} else if (id.toString().includes('SelectMapping.input_')) {
			//parentThis.log.info('matrixChanged(): Neues Routing via Dropdown:' + id + ' ' + val);
			if (ack == false) {	//Aenderung per GUI
				let iStart = id.indexOf('.input_') + 7;
				let tmpIn = id.substring(iStart, id.indexOf('_out'));
				let tmpCMD;
				if (val == 0) {
					parentThis.log.debug('matrixChanged(): Eingang ' + tmpIn + 'AUSgeschaltet');
					tmpCMD = tmpIn + '$.';
				} else {
					parentThis.log.debug('matrixChanged(): Eingang ' + tmpIn + 'auf ' + val.toString());
					tmpCMD = tmpIn + 'v' + val.toString() + '.';
				}
				parentThis.log.debug('matrixChanged(): Command:' + tmpCMD);
				arrCMD.push(tmpCMD);

			}

		} else if (id.toString().includes('SelectMapping.output_')) {
			//parentThis.log.info('matrixChanged(): Neues Routing via Dropdown:' + id + ' ' + val);
			if (ack == false) {	//Aenderung per GUI
				let iStart = id.indexOf('.output_') + 8;
				let tmpOut = id.substring(iStart, id.indexOf('_in'));
				let tmpCMD;
				if (val == 0) {
					parentThis.log.debug('matrixChanged(): Ausgang ' + tmpOut + 'AUSgeschaltet');
					tmpCMD = tmpOut + '$.';
				} else {
					parentThis.log.debug('matrixChanged(): Eingang ' + val.toString() + ' auf ' + tmpOut);
					tmpCMD = val + 'v' + tmpOut + '.';
				}
				parentThis.log.debug('matrixChanged(): Command:' + tmpCMD);
				arrCMD.push(tmpCMD);

			}

		}

		/*
		//this.log.info('Neues Routing: IN: Ein Ausgang kann nur einen definierten Eingang besitzen');
		for (let i = 0; i < parentThis.MAXCHANNELS; i++) {
			if (i + 1 != parseInt(sEingang)) {
				this.log.debug('matrixChanged(): Neues Routing: IN: Ein Ausgang kann nur einen definierten Eingang besitzen. Setzte Eingang ' + (i + 1).toString() + ' fuer Ausgang ' + sAusgang + ' auf FALSE');
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


		if (this.config.optConnection === 'Serial') {
			this.sSerialPortName = this.config.serialPort.trim();
			this.mode = MODE_SERIAL;
		} else if (this.config.optConnection === 'Network') {
			this.mode = MODE_NETWORK;
		} else {
			this.mode = MODE_NONE;
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