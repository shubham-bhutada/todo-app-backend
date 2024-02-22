const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const todoSchema = new Schema(
  {
    todo: {
      type: String,
      required: true,
    },
    username: {
      type: String,
      required: true,
    },
    timeStamp: {
      type: String,
      default: new Date().getHours() +":" + new Date().getMinutes()
    },
  },
  { strict: false }
);

module.exports = mongoose.model("todo", todoSchema);
