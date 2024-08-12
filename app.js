const express = require('express');
const app = express();
const port = process.env.PORT || 3001;

app.use(express.static('public'));

// Define a simple route
app.get('/app', (req, res) => {
  res.send('Hello, World!');
});

// Start the server
const server = app.listen(port, () => console.log(`Example app listening on port ${port}!`));

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;