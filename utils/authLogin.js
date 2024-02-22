const LoginDataValidation = ({ loginId, password }) => {
  return new Promise((resolve, reject) => {
    if (!loginId || !password) {
      reject("Missing credentials");
    }

    resolve();
  });
};

module.exports = { LoginDataValidation };
