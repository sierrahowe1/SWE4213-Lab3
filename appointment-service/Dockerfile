FROM  node:18

WORKDIR /usr/src/app
COPY package*.json ./
EXPOSE 5002
RUN npm install
COPY ./src ./src

CMD npm start