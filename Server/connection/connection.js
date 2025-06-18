const mongoose = require('mongoose');



const ConnectDB=()=>{
    const password = '0246783840Sa';
    const uri = `mongodb+srv://dajounimarket:${password}@cluster0.kp8c2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

    mongoose.connect(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true
      }).then(() => {
        console.log('Connected to MongoDB');
      }).catch(err => {
        console.error('Failed to connect to MongoDB', err);
      });
      
      

}

module.exports=ConnectDB;
