class VppLicenseForm
  include ActiveModel::Model
  include ActiveModel::Attributes

  attribute :adam_id, :string
  attribute :serial_number, :string

  validates :adam_id, presence: true
  validates :serial_number, presence: true

  def associate(vpp_content_token)
    return unless valid?

    vpp = VppClient.new(vpp_content_token.value)
    res = vpp.post('assets/associate', {
      assets: [
        { adamId: adam_id },
      ],
      serialNumbers: [
        serial_number,
      ],
    })
    event_id = res['eventId']

    10.times do
      event = vpp.get('status', { eventId: event_id })
      puts "event=#{event}"
      if event['eventStatus'] != 'PENDING'
        break
      else
        sleep 0.6
      end
    end
  end
end
