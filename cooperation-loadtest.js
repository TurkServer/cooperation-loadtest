sleep = Meteor.wrapAsync(function(time, cb) {
  return Meteor.setTimeout((function() {
    return cb();
  }), time);
});

const num = Meteor.settings.clients;
const batchId = Meteor.settings.batchId;
const url = Meteor.settings.url;

Meteor.startup(function() {
  const clients = [];

  for( let i = 0; i < num; i++ ) {
    const client = DDP.connect(url);

    // Set up collections for this client
    client.users = new Mongo.Collection("users", { connection: client });
    client.LobbyStatus = new Mongo.Collection("ts.lobby", { connection: client });
    client.Experiments = new Mongo.Collection('ts.experiments', { connection: client });

    // Partitioned game collections
    client.Actions = new Mongo.Collection('actions', { connection: client });
    client.Rounds = new Mongo.Collection('rounds', { connection: client });

    // Wait till we're logged in to start doing stuff
    const loginHandle = client.users.find({}).observeChanges({
      added: function(userId) {
        client.userId = userId;
        console.log(`Logged in with ${userId}`);

        Meteor.defer(function() {
          loginHandle.stop();
          startActions(client);
        });
      }
    });

    client.call("login", {
      hitId: `${Random.id()}_HIT`,
      assignmentId: `${Random.id()}_Asst`,
      workerId: `${Random.id()}_Worker`,
      batchId,
      test: true
    });

    clients.push(client);
  }

});

function startActions(client) {
  // Watch the lobby. Whenever we appear in it and are not ready, toggle.
  client.LobbyStatus.find({
    _id: client.userId,
    status: {$ne: true}
  }).observeChanges({
    added: function() {
      try {
	client.call("toggleStatus");
      } catch (e) {
	console.log("Left lobby before we could toggle status.");
      }
    }
  });

  client.subscribe("lobby", batchId);

  // Set up subscriptions to game data
  client.users.find({
    _id: client.userId,
    group: { $exists: true }
  }, {
    fields: { group: 1 }
  }).observeChanges({
    added: function(userId, fields) {
      teardownSubscriptions(client);
      setupSubscriptions(client, fields.group);
    },
    removed: function() {
      teardownSubscriptions(client);
    }
  })
}

function setupSubscriptions(client, group) {
  // TODO subscribe to other things like ts.rounds for load purposes
  // think this is taken care of now?
  client.gameSub = client.subscribe('gameData', group);
  client.tsSub = client.subscribe('tsCurrentExperiment', group);

  console.log("Subscribed to group");

  client.actionHandle = client.Rounds.find({}).observeChanges({
    added: function(id, fields) {
      const index = fields.index;

      try {
        var maxSleep = 7500;
        var minSleep = 1000;
        var sleepAmt = Math.floor(Math.random() * (maxSleep - minSleep)) + minSleep;
        //sleep(sleepAmt);
        console.log(`${client.userId} in group ${group} is taking action for round ${index} on document ${id} with fields `, fields);
        client.call("chooseAction", Math.round(Math.random() + 1), index);
      } catch (e) {
        console.log(`Couldn\'t take action for user ${client.userId} in group ${group} for round ${index} on document ${id} with fields`, fields, e);
      }

    }
  });

  client.endHandle = client.Experiments.find({endReason: {$exists: true}}).observeChanges({
    added: function(id, fields) {
      client.call("goToLobby");
    }
  });
}

function teardownSubscriptions(client) {
  for (let x of [ "gameSub", "tsSub"]) {
    client[x] && client[x].stop();
    delete client[x];
  }

  client.actionHandle && client.actionHandle.stop();
  client.endHandle && client.endHandle.stop();
}
