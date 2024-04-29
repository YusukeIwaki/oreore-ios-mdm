class GetTokenTarget < ActiveRecord::Base
  belongs_to :dep_server_token

  def self.update_target_to(dep_server_token)
    json = DepClient.new(dep_server_token).get('account')
    record = find_or_initialize_by(dep_server_token: dep_server_token)
    ActiveRecord::Base.transaction do
      where.not(dep_server_token: dep_server_token).delete_all
      record.update!(server_uuid: json['server_uuid'])
    end
    record
  end
end
