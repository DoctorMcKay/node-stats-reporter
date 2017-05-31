const REPORT_HOST = "nodestats.doctormckay.com";
const REPORT_PATH = "/report.php";

const Crypto = require('crypto');
const OS = require('os');
const HTTPS = require('https');
const QueryString = require('querystring');

let g_StartupTimestamp = Math.floor(Date.now() / 1000);
let g_RegisteredModules = {};
let g_MachineID = getMachineId();

exports.setup = function(packageJson) {
	if (isOptedOut()) {
		return;
	}

	if (g_RegisteredModules[packageJson.name]) {
		return; // already set up
	}

	g_RegisteredModules[packageJson.name] = packageJson;

	if (Object.keys(g_RegisteredModules).length == 1) {
		// we're the first!
		setupReporting();
	}
};

function isOptedOut() {
	return process.env.NODE_MCKAY_STATISTICS_OPT_OUT || global._mckay_statistics_opt_out;
}

function isDebugging() {
	return process.env.NODE_MCKAY_STATISTICS_DEBUG || global._mckay_statistics_debug;
}

function setupReporting() {
	if (isOptedOut()) {
		return;
	}

	// Report stats hourly, and immediately in 10 minutes
	setInterval(reportStats, 1000 * 60 * 60);
	setTimeout(reportStats, 1000 * 60 * 10);

	if (isDebugging()) {
		setTimeout(reportStats, 1000 * 5);
	}
}

function getMachineId() {
	let macs = [];
	let interfaces = OS.networkInterfaces();
	for (let ifaceName in interfaces) {
		if (!interfaces.hasOwnProperty(ifaceName)) {
			continue;
		}

		let iface = interfaces[ifaceName];
		iface.forEach((virtualInterface) => {
			if (virtualInterface.mac != '00:00:00:00:00:00' && macs.indexOf(virtualInterface.mac) == -1) {
				macs.push(virtualInterface.mac);
			}
		});
	}

	macs.sort();
	let hash = Crypto.createHash('sha1');
	hash.update(macs.join(','), 'ascii');
	return hash.digest('hex');
}

function reportStats() {
	if (isOptedOut()) {
		return;
	}

	let cpus = OS.cpus();

	let reporterVersion = require('./package.json').version;
	let machineId = g_MachineID;
	let arch = OS.arch();
	let cpuSpeedMhz = 0;
	let cpuCount = cpus.length;
	let osPlatform = OS.platform();
	let osRelease = OS.release();
	let totalMemory = OS.totalmem();
	let usedMemory = totalMemory - OS.freemem();
	let osUptimeSeconds = Math.floor(OS.uptime());
	let appUptimeSeconds = Math.floor(Date.now() / 1000) - g_StartupTimestamp;

	cpus.forEach((cpu) => {
		if (cpu.speed > cpuSpeedMhz) {
			cpuSpeedMhz = cpu.speed;
		}
	});

	for (let moduleName in g_RegisteredModules) {
		let module = g_RegisteredModules[moduleName];
		let stats = QueryString.stringify({
			"module": module.name,
			"node_version": process.versions.node,
			"module_version": module.version,
			"reporter_version": reporterVersion,
			"machine_id": machineId,
			"arch": arch,
			"cpu_speed_mhz": cpuSpeedMhz,
			"cpu_count": cpuCount,
			"os_platform": osPlatform,
			"os_release": osRelease,
			"used_memory": usedMemory,
			"total_memory": totalMemory,
			"os_uptime_seconds": osUptimeSeconds,
			"app_uptime_seconds": appUptimeSeconds
		});

		let req = HTTPS.request({
			"method": "POST",
			"hostname": REPORT_HOST,
			"path": REPORT_PATH,
			"headers": {
				"Content-Type": "application/x-www-form-urlencoded",
				"Content-Length": Buffer.byteLength(stats)
			}
		}, (res) => {
			res.on('data', (chunk) => {
				if (isDebugging() && chunk.length > 0) {
					console.log(chunk.toString('ascii'));
				}
			});

			res.on('error', noop);

			if (isDebugging()) {
				console.log("==================================================");
				console.log("Stats reported for " + module.name + "@" + module.version + ": " + res.statusCode);
				console.log(stats);
				console.log("==================================================");
			}
		});

		req.on('error', noop);
		req.end(stats);
	}
}

function noop() {
	// nothing
}
