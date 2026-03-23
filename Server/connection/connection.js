const mongoose = require('mongoose');



const ConnectDB=()=>{
    const password = process.env.MONGO_PASSWORD || '0246783840Sa';
    const uri = process.env.MONGO_URI || `mongodb+srv://dajounimarket:${password}@cluster0.kp8c2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

    mongoose.connect(uri).then(() => {
        console.log('Connected to MongoDB');
      }).catch(err => {
        console.error('Failed to connect to MongoDB', err);
      });
      
      

}

module.exports=ConnectDB;
