import { gql, ApolloError } from 'apollo-server';
import * as yup from 'yup';

import { GithubRepositoryNotFoundError } from '../../utils/githubClient';

export const typeDefs = gql`
  input CreateReviewInput {
    repositoryName: String!
    ownerName: String!
    rating: Int!
    text: String
  }

  extend type Mutation {
    """
    Creates a review for the given repository defined by repositoryName and ownerName.
    """
    createReview(review: CreateReviewInput): Review
  }
`;

class RepositoryAlreadyReviewedError extends ApolloError {
  constructor(message = 'User has already reviewed this repository') {
    super(message, 'REPOSITORY_ALREADY_REVIEWED');
  }
}

const createRepositoryId = (ownerUsername, repositoryName) =>
  [ownerUsername, repositoryName].join('.');

const createReviewInputSchema = yup.object().shape({
  repositoryName: yup
    .string()
    .required()
    .lowercase()
    .trim(),
  ownerName: yup
    .string()
    .required()
    .lowercase()
    .trim(),
  rating: yup
    .number()
    .integer()
    .min(0)
    .max(100)
    .required(),
  text: yup
    .string()
    .max(2000)
    .trim(),
});

export const resolvers = {
  Mutation: {
    createReview: async (
      obj,
      args,
      { models: { Repository, Review }, githubClient, authService },
    ) => {
      const userId = authService.assertIsAuthorized();

      const normalizedReview = await createReviewInputSchema.validate(
        args.review,
        {
          stripUnknown: true,
        },
      );

      const { repositoryName, ownerName } = normalizedReview;

      const existingRepository = await Repository.query().findOne({
        name: repositoryName,
        ownerName,
      });

      const repositoryId = existingRepository
        ? existingRepository.id
        : createRepositoryId(ownerName, repositoryName);

      if (!existingRepository) {
        const githubRepository = await githubClient.getRepository(
          ownerName,
          repositoryName,
        );

        if (!githubRepository) {
          throw GithubRepositoryNotFoundError.fromNames(
            ownerName,
            repositoryName,
          );
        }

        await Repository.query().insert({
          id: repositoryId,
          ownerName,
          name: repositoryName,
        });
      }

      const id = [userId, repositoryId].join('.');

      const existringReview = await Review.query().findById(id);

      if (existringReview) {
        throw new RepositoryAlreadyReviewedError();
      }

      await Review.query().insert({
        id,
        userId,
        repositoryId,
        text: normalizedReview.text,
        rating: normalizedReview.rating,
      });

      return Review.query().findById(id);
    },
  },
};

export default {
  typeDefs,
  resolvers,
};
