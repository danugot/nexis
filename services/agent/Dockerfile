FROM node:20-slim

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./

RUN npm install

COPY . .

CMD ["npm", "start"]
