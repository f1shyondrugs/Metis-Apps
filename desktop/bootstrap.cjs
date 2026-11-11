if(process.platform==='win32'&&process.argv.includes('--metis-drop-helper'))require('./src/main/file-drop-helper.cjs').bootstrap();
else require('./main.cjs');
