# SlideWiki WebRTC Broadcast #
[![Language](https://img.shields.io/badge/Language-Javascript%20ECMA2015-lightgrey.svg?style=flat-square)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Framework](https://img.shields.io/badge/Framework-NodeJS%206-blue.svg?style=flat-square)](https://nodejs.org/)

## Insructions ##

You should have installed [NodeJS](https://nodejs.org/), [npm](https://github.com/npm/npm) and

1. Clone the repository and run `npm install`.
2. Start the application by executiny `node index.js`
3. Start a browser with disabled security feature (cause we use different domains) `google-chrome --disable-web-security --user-data-dir`
4. Go to `http://localhost:8080` and enter a room name
5. Open another tab, go to the same adress and enter the same room name.

After executing all mentioned steps, the first tab is the presenter and all other tabs (in the same room) are listeners. Try to play with the application!
