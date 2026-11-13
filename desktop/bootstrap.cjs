// Fixed background roles must be selected before normal desktop/profile startup.
if(process.platform==='win32'&&process.argv.includes('--metis-drop-helper'))require('./src/main/file-drop-helper.cjs').bootstrap();
else if(process.argv.some(arg=>arg.startsWith('--metis-device-host=')))require('./src/device/admin-host.cjs').bootstrap();
else require('./main.cjs');
