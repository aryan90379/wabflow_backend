const mongoose = require('mongoose');
mongoose.connect('mongodb://localhost:27017/wabflow').then(async () => {
  const db = mongoose.connection.db;
  const biz = await db.collection('businesses').findOne({ _id: new mongoose.Types.ObjectId('6a2dea4a60be54f68e5a5ac1') });
  console.log(JSON.stringify(biz.missedCallConfig, null, 2));
  process.exit(0);
});
