sleep = Meteor.wrapAsync(function(time, cb) {
  return Meteor.setTimeout((function() {
    return cb();
  }), time);
});

const num = 100;
const batchId = Meteor.settings.batchId;

Meteor.startup(function() {
  const clients = [];

  for( let i = 0; i < num; i++ ) {
    const client = DDP.connect("http://localhost:" + Meteor.settings.port);

    // Set up collections for this client
    client.users = new Mongo.Collection("users", { connection: client });
    client.LobbyStatus = new Mongo.Collection("ts.lobby", { connection: client });

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
      client.call("toggleStatus");
    }
  });

  client.subscribe("lobby", batchId);

  // Set up subscriptions to game data
  client.users.find({
    _id: client.userId,
    "turkserver.group": {$exists: true}
  }, {
    fields: { "turkserver.group": 1 }
  }).observeChanges({
    added: function(userId, fields) {
      setupSubscriptions(client, fields.turkserver.group);
    },
    removed: function() {
      teardownSubscriptions(client);
    }
  })
}

function setupSubscriptions(client, group) {
  teardownSubscriptions(client);

  client.userSub = client.subscribe('users', group);
  client.roundsSub = client.subscribe('rounds', group);
  client.actionsSub = client.subscribe('actions', group);
  client.gameSub = client.subscribe('games', group);
}

function teardownSubscriptions(client) {
  for (let x in [ "userSub", "roundsSub", "actionsSub", "gameSub"]) {
    client[x] && client[x].stop();
    delete client[x];
  }
}
