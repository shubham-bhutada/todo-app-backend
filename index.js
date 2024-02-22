const express = require("express");
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const validator = require("validator");
const session = require("express-session");
const mongoDbsession = require("connect-mongodb-session")(session);

//file-imports
const { userDataValidation } = require("./utils/authUtil");
const userModel = require("./models/userModel");
const { LoginDataValidation } = require("./utils/authLogin");
const { isAuth } = require("./middlewares/authMiddleware");
const { todoDataValidation } = require("./utils/todoUtil");
const todoModel = require("./models/todoModel");
const rateLimiting = require("./middlewares/rateLimiting");

//constants
const app = express();
const PORT = process.env.PORT;
const store = new mongoDbsession({
  uri: process.env.MONGO_URI,
  collection: "sessions",
});

//middlewares
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

//Db connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDb connected successfully");
  })
  .catch((err) => {
    console.log(err);
  });

//apis
app.get("/", (req, res) => {
  return res.render("homePage");
});

app.post("/login_redirect", (req, res) => {
  return res.redirect("/login");
});

app.post("/signup_redirect", (req, res) => {
  return res.redirect("/register");
});

app.get("/register", (req, res) => {
  return res.render("registerPage");
});

app.post("/register", async (req, res) => {
  const { name, email, username, password } = req.body;

  //data validation
  try {
    await userDataValidation({ name, password, email, username });
  } catch (error) {
    return res.send({
      status: 400,
      message: "user data error",
      error: error,
    });
  }

  //check if email and username already exist or not
  const userEmailExist = await userModel.findOne({ email });
  if (userEmailExist) {
    return res.send({
      status: 400,
      message: "Email already exist",
    });
  }

  const userUsernameExist = await userModel.findOne({ username });
  if (userUsernameExist) {
    return res.send({
      status: 400,
      message: "Username already exist",
    });
  }

  //hashed password
  const hashedPassword = await bcrypt.hash(password, Number(process.env.SALT));

  //store the data in Db
  const userObj = new userModel({
    name,
    email,
    username,
    password: hashedPassword,
  });

  try {
    const userDb = await userObj.save();
    // return res.send({
    //   status: 201,
    //   message: "Registeration successfull",
    //   data: userDb,
    // });
    return res.redirect("/login");
  } catch (error) {
    return res.send({
      status: 500,
      message: "Database error from registration",
      error: error,
    });
  }
});

app.get("/login", (req, res) => {
  return res.render("loginPage");
});

app.post("/login", async (req, res) => {
  const { loginId, password } = req.body;

  try {
    await LoginDataValidation({ loginId, password });
  } catch (error) {
    return res.send({
      status: 400,
      message: "login data error",
      error,
    });
  }

  //find the user from DB with loginId
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
        message: "User not found, please register",
      });
    }

    //compare the password

    const isPasswordMatched = await bcrypt.compare(password, userDb.password);

    if (!isPasswordMatched) {
      return res.send({
        status: 400,
        message: "Password does not match",
      });
    }

    //session bases auth
    req.session.isAuth = true;
    req.session.user = {
      userId: userDb._id,
      email: userDb.email,
      username: userDb.username,
    };

    // return res.send({
    //   status: 200,
    //   message: "Login successfull",
    // });
    return res.redirect("/dashboard");
  } catch (error) {
    return res.send({
      status: 500,
      message: "Database error",
      error,
    });
  }
});

app.get("/dashboard", isAuth, (req, res) => {
  return res.render("dashboardPage");
});

app.post("/logout", isAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.send({
        status: 500,
        message: "logout unsuccessful",
      });
    } else {
      return res
        .send({
          status: 200,
          message: "logout successful",
        })
        .redirect("/login");
    }
  });
});

app.post("/logout_from_all_devices", isAuth, async (req, res) => {
  const username = req.session.user.username;

  //session Schema
  const sessionSchema = new mongoose.Schema({ _id: String }, { strict: false });
  const sessionModel = mongoose.model("session", sessionSchema);

  try {
    const deleteDb = await sessionModel.deleteMany({
      "session.user.username": username,
    });
    console.log(deleteDb);
    return res
      .send({
        status: 200,
        message: "Logot from all devices is successful",
      })
      .redirect("/login");
  } catch (error) {
    return res
      .send({
        status: 500,
        message: "Database error",
      })
      .redirect("/login");
  }
});

//TODO API's

app.post("/create-item", isAuth, rateLimiting, async (req, res) => {
  //todoText, username
  const todoText = req.body.todo;
  const username = req.session.user.username;

  //data validation
  try {
    await todoDataValidation({ todoText });
  } catch (error) {
    return res.send({
      status: 400,
      message: "todo data error",
      error: error,
    });
  }

  const todoObj = new todoModel({
    todo: todoText,
    username: username,
  });

  try {
    const todoDb = await todoObj.save();
    return res.send({
      status: 201,
      message: "Todo created successfully",
      data: todoDb,
    });
  } catch (error) {
    return res.send({
      status: 500,
      message: "Database error",
      error,
    });
  }
});

// /read-item?skip=x
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
        message: SKIP === 0 ? "No todos found" : "No more todos to show",
      });
    }

    return res.send({
      status: 200,
      message: "Read success",
      data: todos[0].data,
    });
  } catch (error) {
    return res.send({
      status: 500,
      message: "Database error",
      error,
    });
  }
});

app.post("/edit-item", isAuth, rateLimiting, async (req, res) => {
  const { id, newData } = req.body;
  const username = req.session.user.username;

  //find the todo in db
  try {
    const todoDb = await todoModel.findOne({ _id: id });

    if (!todoDb)
      return res.send({
        status: 400,
        message: "Todo not found",
      });

    //check the ownership
    if (username !== todoDb.username)
      return res.send({
        status: 403,
        message: "Not authorized to edit the todo",
      });

    const prevTodo = await todoModel.findOneAndUpdate(
      { _id: id },
      { todo: newData }
    );

    return res.send({
      status: 200,
      message: "Todo edited successfully",
      data: prevTodo,
    });
  } catch (error) {
    return res.send({
      status: 500,
      message: "Database error",
      error,
    });
  }
});

app.post("/delete-item", isAuth, rateLimiting, async (req, res) => {
  const { id } = req.body;
  const username = req.session.user.username;

  if (!id)
    return res.send({
      status: 400,
      message: "todo id missing",
    });

  //find the todo
  try {
    const todoDb = await todoModel.findOne({ _id: id });

    if (!todoDb)
      return res.send({
        status: 400,
        message: `Todo not found with id :${id}`,
      });

    //comparing the todo with the owner
    if (todoDb.username !== username)
      return res.send({
        status: 403,
        message: "user is unauthorized for making this request",
      });

    //delete the todo
    const deletedTodo = await todoModel.findOneAndDelete({ _id: id });

    return res.send({
      status: 200,
      message: "Todo deleted successfully",
      data: deletedTodo,
    });
  } catch (error) {
    return res.send({
      status: 500,
      message: "Database error",
      error,
    });
  }
});

app.listen(PORT, () => {
  console.log(` Todo app server is running at : http://localhost:${PORT}`);
});
