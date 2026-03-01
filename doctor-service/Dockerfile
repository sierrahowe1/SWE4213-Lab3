FROM  node:18

WORKDIR /usr/src/app
COPY package*.json ./
EXPOSE 5002
RUN npm install
COPY . .

CMD npm start