const accessModel = require("../models/accessModel");

const rateLimiting = async (req, res, next) => {
  console.log(req.session.id);
  const sessionId = req.session.id;

  //find the entry with sessionId

  try {
    const accessDb = await accessModel.findOne({ sessionId });

    //check if it is first request
    if (!accessDb) {
      const acccessObj = new accessModel({
        sessionId,
        time: Date.now(),
      });
      //create an entry inside the Db
      await acccessObj.save();
      console.log("inside", accessDb);
      next();
      return;
    }

    console.log((Date.now() - accessDb.time) / 1000);

    const diff = (Date.now() - accessDb.time) / 1000;

    if (diff < 5) {
      return res.send({
        status: 400,
        message: "Too many request, please wait for some time.",
      });
    }
    await accessModel.findOneAndUpdate({ sessionId }, { time: Date.now() });
    next();
  } catch (error) {
    return res.send({
      status: 500,
      message: "Database error, via ratelimitng",
      error: error,
    });
  }
};

module.exports = rateLimiting;
