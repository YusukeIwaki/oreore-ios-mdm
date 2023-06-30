require 'spec_helper'

RSpec.describe CommandQueue do
  it 'should enqueue and dequeue (FIFO)' do
    q = CommandQueue.new(1)
    command1 = Command::DeviceInformation.new
    command2 = Command::InstalledApplicationList.new

    q << command1
    q << command2

    command = q.dequeue
    expect(command['CommandUUID']).to eq(command1.request_payload[:CommandUUID])
    expect(command['Command']['RequestType']).to eq('DeviceInformation')

    command = q.dequeue
    expect(command['CommandUUID']).to eq(command2.request_payload[:CommandUUID])
    expect(command['Command']['RequestType']).to eq('InstalledApplicationList')
  end

  it 'should bulk insert' do
    command1 = Command::DeviceInformation.new
    command2 = Command::InstalledApplicationList.new

    CommandQueue.bulk_insert([1, 2], [command1, command2])
    q1 = CommandQueue.new(1)
    q2 = CommandQueue.new(2)

    command = q1.dequeue
    expect(command['CommandUUID']).to eq(command1.request_payload[:CommandUUID])
    expect(command['Command']['RequestType']).to eq('DeviceInformation')

    command = q1.dequeue
    expect(command['CommandUUID']).to eq(command2.request_payload[:CommandUUID])
    expect(command['Command']['RequestType']).to eq('InstalledApplicationList')

    command = q2.dequeue
    expect(command['CommandUUID']).to eq(command1.request_payload[:CommandUUID])
    expect(command['Command']['RequestType']).to eq('DeviceInformation')

    command = q2.dequeue
    expect(command['CommandUUID']).to eq(command2.request_payload[:CommandUUID])
    expect(command['Command']['RequestType']).to eq('InstalledApplicationList')
  end

  it 'should be retryable' do
    q = CommandQueue.new(1)
    command1 = Command::DeviceInformation.new
    command2 = Command::InstalledApplicationList.new

    q << command1
    q << command2

    command = q.dequeue # handle command

    handling_request = q.dequeue_handling_request(command_uuid: command['CommandUUID']) # handle result
    original_command_uuid = command['CommandUUID']

    q << handling_request # retry!

    command = q.dequeue
    expect(command['CommandUUID']).to eq(command2.request_payload[:CommandUUID])
    expect(command['Command']['RequestType']).to eq('InstalledApplicationList')

    command = q.dequeue
    expect(command['CommandUUID']).to eq(original_command_uuid)
    expect(command['Command']['RequestType']).to eq('DeviceInformation')
  end
end
