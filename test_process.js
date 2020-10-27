const { Process } = require("./v2");

let p = new Process();

// async function contentFunc () {
//     await p.takeConfig()
//     console.log({
//         id: p.id,
//         config: p.config
//     })
// }
// contentFunc()

p.run().then(
  () => {
    console.log("initialized");
  },
  (err) => {
    console.error(err);
  }
);
