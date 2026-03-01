FROM  node:18

WORKDIR /usr/src/app
COPY package*.json ./
EXPOSE 5001
RUN npm install
COPY . .

CMD npm start