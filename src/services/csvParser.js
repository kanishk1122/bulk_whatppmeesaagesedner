import Papa from "papaparse";

export const parseCSV = (file) => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const contacts = results.data
            .map((row, index) => {
              const displayName =
                row["Display Name"] || row["displayName"] || row["name"];
              const mobileNumber =
                row["Mobile Number"] || row["mobile"] || row["phone"];

              if (!displayName || !mobileNumber) {
                console.warn(`Row ${index + 1}: Missing required fields`);
                return null;
              }

              return {
                displayName: displayName.trim(),
                mobileNumber: mobileNumber.replace(/\D/g, ""), // Remove non-digits
                id: index,
              };
            })
            .filter((contact) => contact !== null);

          resolve(contacts);
        } catch (error) {
          reject(error);
        }
      },
      error: (error) => {
        reject(error);
      },
    });
  });
};
