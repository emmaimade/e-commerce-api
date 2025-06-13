import express from 'express';
import bodyParser from 'body-parser';

import db from './config/db.js';

const app = express();
const port = process.env.PORT;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

app.get('/health', (req, res) => {
    res.send('ok');
})

app.listen(port, () => {
    console.log(`server is running on http://localhost:${port}`);
})
