import express from 'express';
import bodyParser from 'body-parser';


const app = express();
const port = process.env.PORT;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

app.listen(port, () => {
    console.log(`server is running on http://localhost:${port}`);
})
