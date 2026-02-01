export const getRegisterScripts = (email: string) => {
  const curl = `curl 'https://tinify.com/web/api' \\
  -H 'content-type: application/json' \\
  --data-raw '{"fullName":"${email}","mail":"${email}"}'`

  const python = `import requests
import json

url = "https://tinify.com/web/api"
payload = {
    "fullName": "${email}",
    "mail": "${email}"
}
headers = {
    "Content-Type": "application/json"
}

response = requests.post(url, json=payload, headers=headers)
print(response.text)`

  const nodejs = `fetch("https://tinify.com/web/api", {
  "headers": {
    "content-type": "application/json",
  },
  "body": JSON.stringify({
    "fullName": "${email}",
    "mail": "${email}"
  }),
  "method": "POST"
})
.then(res => res.text())
.then(console.log);`

  return { curl, python, nodejs }
}
