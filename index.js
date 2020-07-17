require('dotenv').config()
const uuid = require('uuid')
const app = require('express')()
const bodyParser = require('body-parser')
const nedb = require('nedb-promises')
const Nexmo = require('nexmo')
const nunjucks = require('nunjucks')

const organizerNumbers = process.env.NUMBERS.split(',') // replace with array of strings

const nexmo = new Nexmo({ 
  apiKey: process.env.NEXMO_KEY, 
  apiSecret: process.env.NEXMO_SECRET,
  applicationId: process.env.APPLICATION_ID,
  privateKey: './private.key'
})

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))
nunjucks.configure('views', { express: app })

const recordingsDb = nedb.create({ filename: 'data/recordings.db', autoload: true })
const messagesDb = nedb.create({ filename: 'data/messages.db', autoload: true })

app.get('/answer', async (req, res) => {
  const conferenceId = uuid.v4()

  for(let organizerNumber of organizerNumbers) {
    nexmo.calls.create({
      to: [{ type: 'phone', number: organizerNumber }],
      from: { type: 'phone', number: process.env.NEXMO_NUMBER },
      ncco: [
        { action: 'conversation', name: conferenceId }
      ]
    })
  }

  res.json([
    { action: 'talk', voiceName: 'Amy', text: 'This is the Code of Conduct Incident Response Line' },
    { action: 'conversation', name: conferenceId, record: true }
  ])
})

app.post('/event', async (req, res) => { 
  if(req.body.recording_url) {
    await recordingsDb.insert(req.body)
  }
  res.status(200).end()
})

app.get('/', async (req, res) => {
  const recordings = await recordingsDb.find().sort({ timestamp: -1 })
  const messages = await messagesDb.find().sort({ 'message-timestamp': -1 })
  res.render('index.html', { recordings, messages })
})

app.get('/details/:conversation', (req, res) => {
  nexmo.conversations.get(req.params.conversation, async (error, result) => {
    const caller = result.members.find(member => member.channel.from != process.env.NEXMO_NUMBER)
    const number = caller.channel.from.number
    const recording = await recordingsDb.findOne({ conversation_uuid: req.params.conversation })
    res.render('detail.html', { number, recording })
  })
})

app.post('/sms', async (req, res) => {
  await messagesDb.insert(req.body)

  for(let organizerNumber of organizerNumbers) {
    nexmo.channel.send(
      { type: 'sms', number: organizerNumber },
      { type: 'sms', number: process.env.NEXMO_NUMBER },
      { content: { type: 'text', text: `From ${req.body.msisdn}\n\n${req.body.text}` } }
    )
  }

  nexmo.channel.send(
    { type: 'sms', number: req.body.msisdn },
    { type: 'sms', number: process.env.NEXMO_NUMBER },
    { content: { type: 'text', text: 'Thank you for sending us a message. Organizers have been made aware and may be in touch for more information.' } }
  )

  res.status(200).end()
})

app.listen(3000)
