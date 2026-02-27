FROM node:18-alpine  

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY ./src ./src
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
RUN chown -R nodejs:nodejs /usr/src/app
USER nodejs

CMD npm start