const todoDataValidation = ({ todoText }) => {
    
  return new Promise((resolve, reject) => {
    if (!todoText) {
      reject("Todo text is empty");
    }
    if (typeof todoText !== "string") {
      reject("Todo text must be a text");
    }
    if (todoText.length < 3 || todoText.length > 200) {
      reject("Todo text length should be between 3 - 200");
    }
    resolve();
  });
};

module.exports = { todoDataValidation };
