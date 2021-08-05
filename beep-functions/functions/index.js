const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//

const firestore = admin.firestore();

const { google } = require("googleapis");
const sheets = google.sheets("v4");
const _ = require("lodash");

const spreadsheetId = "1hjaRG-cI8KPR6uj-izbMZEgFW0ps9QgsV5WdwcNpnm0";

const serviceAccount = require("./serviceAccount.json");

const jwtClient = new google.auth.JWT({
  email: serviceAccount.client_email,
  key: serviceAccount.private_key,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const jwtAuthPromise = jwtClient.authorize();

exports.getInventoryProgress = functions.https.onRequest((request, response) => {
  const {companyCode, inventoryCode, generateReport} = request.query;
  
  const companyReference = firestore.collection("companies").doc(companyCode);
  const inventoryReference = companyReference.collection("inventories").doc(inventoryCode);
  
  inventoryReference.get()
    .then(async (inventory) => {
      const inventoryData = inventory.data();
      const inventoryName = inventoryData.name;
      const inventoryDescription = inventoryData.description;
      const inventoryProducts = [];
      const inventoryLocations = [];
      const sessions = [];

      const productsReference = await inventory.ref.collection("products").get();
      productsReference.docs.forEach((productDoc) => {
          const productData = productDoc.data();
          inventoryProducts.push({
            code: productData.code,
            name: productData.name,
            packaging: productData.packaging    
          });
      });

      const locationsReference = await inventory.ref.collection("locations").get();
      locationsReference.docs.forEach((locationDoc) => {
          const locationData = locationDoc.data();
          inventoryLocations.push(locationData.name);
      });

      const sessionsReference = await inventory.ref.collection("sessions").get();
      sessionsReference.docs.forEach((sessionDoc) => {
        const sessionName = sessionDoc.data().name;  
        sessions[sessionName] = {
          session: sessionName,
          addressCountingList: []
        };
      });

      const allocationsReference = await inventory.ref.collection("allocations").get();
      await Promise.all(allocationsReference.docs.map(async (allocationDoc) => {
        const allocationData = allocationDoc.data();
        const location = allocationData.location;
        const employee = allocationData.employee;
        const session = allocationData.session;

        const countings = [];
        const countingReference = await allocationDoc.ref.collection("counting").get();
        countingReference.docs.forEach((countingDoc) => {
          const countingData = countingDoc.data();
          countings.push({
            name: countingData.name,
            code: countingData.code,
            packaging: countingData.packaging,
            quantity: countingData.quantity
          });      
        });

        sessions[session].addressCountingList.push({
          location: location,
          employee: employee,
          countedItems: countings
        });
      }));
      
      const countings = [];

      for (const [session, value] of Object.entries(sessions)) {
        countings.push(value);
        console.log(value);
      }
      const inventoryProgressResult = {
        inventoryName: inventoryName,
        inventoryDescription: inventoryDescription,
        products: inventoryProducts,
        locations: inventoryLocations,
        counting: countings
      }

      if (generateReport) {
        const countingReport = [];
        inventoryProgressResult.counting.forEach((countSession) => {
          const sessionReport = {
            session: countSession.session,
            productsCounting: []
          }
          inventoryProducts.forEach((product) => {
            const productCounting = {
              product: product.name,
              code: product.code,
              total: 0.0
            };

            countSession.addressCountingList.forEach((counting) => {
              counting.countedItems.forEach((countedItem) => {
                if (countedItem.code == product.code) {
                  productCounting.total += countedItem.quantity;
                }
              });
            });
            sessionReport.productsCounting.push(productCounting);
          });
          countingReport.push(sessionReport);
        });

        const sheetHeader = ["Produto", "Código"];
        inventoryProgressResult.counting.forEach((counting) => {
          sheetHeader.push(counting.session);
        });

        const sheetData = [sheetHeader];
        inventoryProgressResult.products.forEach((product) => {
          const sheetRow = [product.name, product.code];

          countingReport.forEach((counting) => {
            counting.productsCounting.forEach((productCounting) => {
              if (productCounting.code == product.code) {
                sheetRow.push(productCounting.total);
                return;
              }
            });
          });
          sheetData.push(sheetRow);
        });
        sheets.spreadsheets.values.update({
          spreadsheetId: spreadsheetId,
          auth: jwtClient,
          range: "A1",
          valueInputOption: "RAW",
          requestBody: {
            values: sheetData
          }
        });
        return response.json(countingReport);
      }
      return response.json(inventoryProgressResult);
    })
    .catch((e) => {
      return response.json(e);
    });
});
