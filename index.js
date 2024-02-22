const express = require("express");
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const validator = require("validator");
const session = require("express-session");
const mongoDbSession = require("connect-mongodb-session")(session);

//file imports
const { userDataValidation } = require("./utils/authUtil");
const userModel = require("./models/userModel");
const { LoginDataValidation } = require("./utils/authLogin");
const { isAuth } = require("./middlewares/authMiddleware");
const { todoDataValidation } = require("./utils/todoUtil");
const todoModel = require("./models/todoModel");
const rateLimiting = require("./middlewares/rateLimiting");

// constants
const app = express();
const PORT = process.env.PORT;
const store = new mongoDbSession({
  uri: process.env.MONGO_URI,
  collection: "sessions",
});

// middlewares
app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SECRET_KEY,
    resave: false,
    saveUninitialized: false,
    store,
  })
);
app.use(express.static("public"));

// db connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected successfully");
  })
  .catch((error) => {
    console.log(error);
  });

//apis
app.get("/", (req, res) => {
  // return res.send("App Server running");
  return res.render("homePage");
});

app.post("/login_redirect", (req, res) => {
  return res.redirect("/login");
});

app.post("/signup_redirect", (req, res) => {
  return res.redirect("/signup");
});

app.get("/signup", (req, res) => {
  return res.render("SignUpPage");
});

app.post("/signup", async (req, res) => {
  console.log(req.body);

  const { name, email, username, password } = req.body;

  // data validation
  try {
    await userDataValidation({ name, email, username, password });
  } catch (error) {
    return res.send({
      status: 400,
      message: "user data error",
      error: error,
    });
  }

  // checking if email is present in Db or not
  const emailExistInDb = await userModel.findOne({ email });

  if (emailExistInDb) {
    return res.send({
      status: 400,
      message: "Email already exists !!",
    });
  }

  const usernameExistInDb = await userModel.findOne({ username });

  if (usernameExistInDb) {
    return res.send({
      status: 400,
      message: "username already exists !!",
    });
  }

  // generating hashed password
  const hashPassword = await bcrypt.hash(password, Number(process.env.SALT));

  // storing data in Db
  const userObj = new userModel({
    name,
    email,
    username,
    password: hashPassword,
  });

  try {
    const userDb = await userObj.save();
    // return res.send({
    //   status: 201,
    //   message: "Signup successful",
    //   data: userDb,
    // });
    return res.redirect("/login");
  } catch (error) {
    return res.send({
      status: 500,
      message: "database error",
      error: error,
    });
  }
});

app.get("/login", (req, res) => {
  return res.render("LoginPage");
});

app.post("/login", async (req, res) => {
  console.log(req.body);

  const { loginId, password } = req.body;

  try {
    await LoginDataValidation({ loginId, password });
  } catch (error) {
    return res.send({
      status: 400,
      message: "login data error",
      error: error,
    });
  }
  try {
    let userDb;

    if (validator.isEmail(loginId)) {
      userDb = await userModel.findOne({ email: loginId });
    } else {
      userDb = await userModel.findOne({ username: loginId });
    }

    if (!userDb) {
      return res.send({
        status: 400,
        message: "user not found, please signup!",
      });
    }

    const passwordMatching = await bcrypt.compare(password, userDb.password);

    if (!passwordMatching) {
      return res.send({
        status: 400,
        message: "Incorrect password",
      });
    }

    // session based auth
    req.session.isAuth = true;
    req.session.user = {
      userId: userDb._id,
      email: userDb.email,
      username: userDb.username,
    };

    // return res.send({
    //   status: 200,
    //   message: "Login Successful",
    // });
    return res.redirect("/dashboard");
  } catch (error) {
    return res.send({
      status: 500,
      message: "database error",
      error: error,
    });
  }
});

app.get("/dashboard", isAuth, (req, res) => {
  return res.render("dashboardPage");
});

app.post("/logout", isAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json("Logont unsuccessful");
    } else {
      res.status(200).redirect("/login");
    }
  });
});

app.post("/logout_from_all_devices", isAuth, async (req, res) => {
  const username = req.session.user.username;

  const sessionSchema = mongoose.Schema({ _id: String }, { strict: false });
  const sessionModel = mongoose.model("session", sessionSchema);

  try {
    const sessionDb = await sessionModel.deleteMany({
      "session.user.username": username,
    });
    console.log(sessionDb);
    res.status(200).redirect("/login");
  } catch (error) {
    res.send({
      status: 500,
      message: "database error",
      error: error,
    });
  }
});

app.post("/create-item", isAuth, rateLimiting, async (req, res) => {
  const todoText = req.body.todo;
  const todoTime = req.body.time;
  const username = req.session.user.username;

  try {
    await todoDataValidation({ todoText });
  } catch (error) {
    return res.send({
      status: 400,
      message: "todo text error",
      error: error,
    });
  }

  const todoObj = new todoModel({
    todo: todoText,
    username,
    todoTime,
  });

  try {
    const todoDb = await todoObj.save();
    console.log(todoDb);
    return res.send({
      status: 201,
      message: "todo created successfully",
      data: todoDb,
    });
  } catch (error) {
    return res.send({
      status: 500,
      message: "database error",
      error,
    });
  }
});

app.get("/read-item", isAuth, async (req, res) => {
  const username = req.session.user.username;
  const SKIP = Number(req.query.skip) || 0;
  const LIMIT = 5;

  //mongodb agggregate, skip, limit, match
  try {
    const todos = await todoModel.aggregate([
      {
        $match: { username: username },
      },
      {
        $facet: {
          data: [{ $skip: SKIP }, { $limit: LIMIT }],
        },
      },
    ]);

    if (todos[0].data.length === 0) {
      return res.send({
        status: 400,
        message: SKIP === 0 ? "No todos found" : "No more todos",
      });
    }

    console.log(todos[0].data);
    return res.send({
      status: 200,
      message: "Read success",
      data: todos[0].data,
    });
  } catch (error) {
    return res.send({
      status: 500,
      message: "Database error",
      error: error,
    });
  }
});

app.post("/edit-item", isAuth, async (req, res) => {
  const { newTodo, id } = req.body;
  const username = req.session.user.username;

  // find the todo in DB
  try {
    const todoDb = await todoModel.findOne({ _id: id });

    if (!todoDb) return res.status(400).json("Todo not found");
    // check if the request(username) is the one who's todo it is
    if (todoDb.username !== username)
      return res
        .status(403)
        .json("You are unauthorized for making this request");

    await todoModel.findOneAndUpdate({ _id: id }, { todo: newTodo });

    return res.status(200).json("Todo updated successfully");
  } catch (error) {
    return res.send({
      status: 500,
      message: "database error",
      error,
    });
  }
});

app.post("/delete-item", isAuth, async (req, res) => {
  const { id } = req.body;
  const username = req.session.user.username;

  if (!id) return res.status(400).json("Todo id missing");

  // find the todo in DB
  try {
    const todoDb = await todoModel.findOne({ _id: id });

    if (!todoDb) return res.status(400).json("No todo found");
    if (id !== todoDb.id)
      return res
        .status(403)
        .json("You are unauthorized for making this request");

    const deletedTodo = await todoModel.findOneAndDelete({ _id: id });

    return res.send({
      status: 200,
      message: "Todo deleted successfully",
      data: deletedTodo,
    });
  } catch (error) {
    return res.send({
      status: 500,
      message: "database error",
      error,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Todo app server is running at: http://localhost/${PORT}`);
});
