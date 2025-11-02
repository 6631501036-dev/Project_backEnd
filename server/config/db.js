const mysql = require("mysql2");

const con = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'moblie'
});

con.connect(function(err) {
    if (err) {
        console.error('Error connecting: ' + err.stack);
        return;
    }
    console.log('Connected to database');
});

module.exports = con;